// Clipboard trio (copy / cut / paste) and inline images (insert via
// toolbar/clipboard, click-select, delete).

import { S, chars, siblingPath } from "./state.js";
import { report } from "./render.js";
import { drawCaret, drawSelection, selectedText } from "./view.js";
import { edit, deleteSel, replaceSelWith } from "./edit.js";
import { finalizeComposition } from "./ime.js";
import { findq, replq } from "./find.js";

// Plain text only. Multi-line text becomes paragraph splits (one history
// entry via wasm paste_text). A selection is replaced first: single-line
// pastes ride the atomic replace path; multi-line over a selection is
// delete + paste (two history entries — a recorded limitation).
export function doPaste(text: string) {
  if (!text) return;
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (S.sel && lines.length === 1) { replaceSelWith(text); return; }
  if (S.sel) deleteSel();
  if (!S.caret) return;
  const at = { ...S.caret };
  edit(() => {
    const json = S.conv.paste_text(at.path, at.off, text);
    S.caret = lines.length === 1
      ? { path: at.path, off: at.off + chars(text).length }
      : { path: siblingPath(at.path, lines.length - 1)!, off: chars(lines[lines.length - 1]).length };
    S.sel = null;
    return json;
  });
}

export async function insertImageBytes(bytes: Uint8Array, name: string) {
  if (!S.caret || !S.caret.path.startsWith("d/")) {
    report("이미지: 본문에 캐럿을 두세요");
    return;
  }
  const at = { ...S.caret };
  edit(() => {
    const json = S.conv.insert_image(at.path, at.off, bytes, name);
    S.caret = at; // zero text chars: the offset stays valid
    S.sel = null;
    return json;
  });
}

// Click-selected inline image: outlined in the DOM, deleted with
// Delete/Backspace via its document-order index (matches <image> order).
export function clearImageSel() {
  if (S.imageSel && S.imageSel.el) S.imageSel.el.style.outline = "";
  S.imageSel = null;
}

export function selectImage(el: SVGImageElement) {
  clearImageSel();
  finalizeComposition();
  const all = [...document.querySelectorAll("#pages svg image")];
  const index = all.indexOf(el);
  if (index === -1) return;
  S.caret = null;
  S.sel = null;
  drawCaret();
  drawSelection();
  el.style.outline = "2px solid #1a73e8";
  S.imageSel = { el, index };
  report(`이미지 선택 (${index + 1}번째) — Delete로 삭제`);
}

export function deleteSelectedImage() {
  if (!S.imageSel) return;
  const idx = S.imageSel.index;
  clearImageSel();
  edit(() => S.conv.remove_image(idx));
}

export async function copySelection() {
  const text = selectedText();
  if (!text) return;
  S.lastCopied = text;
  try { await navigator.clipboard.writeText(text); } catch (e) { /* headless */ }
  report(`copied ${chars(text).length} chars`);
}

// Cut = copy, then the ordinary selection deletion (one history entry).
export function cutSelection() {
  if (!S.sel) return;
  copySelection();
  deleteSel();
}

export function wireClipboard() {
  const imgfileEl = document.getElementById("imgfile") as HTMLInputElement;
  document.getElementById("imgbtn")!.onclick = () => imgfileEl.click();
  imgfileEl.addEventListener("change", async () => {
    const f = imgfileEl.files && imgfileEl.files[0];
    imgfileEl.value = "";
    if (!f) return;
    insertImageBytes(new Uint8Array(await f.arrayBuffer()), f.name);
  });

  document.addEventListener("paste", async (e) => {
    if (e.target === findq || e.target === replq) return;
    if ((e.target as HTMLElement)?.id === "linkq") return;
    if ((e.target as HTMLElement)?.id === "commentq") return;
    const img = e.clipboardData && [...(e.clipboardData.files || [])].find((f) => f.type.startsWith("image/"));
    if (img) {
      e.preventDefault();
      insertImageBytes(new Uint8Array(await img.arrayBuffer()), img.name || "pasted.png");
      return;
    }
    const text = e.clipboardData && e.clipboardData.getData("text/plain");
    if (text == null) return;
    e.preventDefault();
    doPaste(text);
  });
}

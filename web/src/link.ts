// Hyperlinks: the inline link bar (no native dialogs — they block
// headless runs), Ctrl+click to follow, and the insert/remove commands.

import { S } from "./state.js";
import { report } from "./render.js";
import { drawCaret, drawSelection, refForOffset } from "./view.js";
import { edit, selectionRanges } from "./edit.js";
import type { ParaRange } from "./edit.js";
import { orderSel } from "./state.js";

const linkbar = () => document.getElementById("linkbar")!;
const linkq = () => document.getElementById("linkq") as HTMLInputElement;

// The selection captured when the bar opened — clicking into the input
// must not lose what the link will wrap.
let pending: ParaRange | null = null;

export function openLinkBar() {
  const ranges = selectionRanges();
  const caretIn = S.caret && linkUrlAt(S.caret.path, S.caret.off);
  if ((!ranges || ranges.length !== 1) && !caretIn) {
    report("링크: 한 문단 안에서 텍스트를 선택하세요");
    return;
  }
  pending = ranges && ranges.length === 1 ? ranges[0] : null;
  linkbar().hidden = false;
  linkq().value = caretIn || "";
  linkq().focus();
  linkq().select();
}

export function closeLinkBar() {
  linkbar().hidden = true;
  pending = null;
}

export function linkUrlAt(path: string, off: number): string | null {
  try { return S.conv.hyperlink_at(path, off) ?? null; }
  catch (e) { return null; }
}

// Wrap the captured selection (or the current one) in a link.
export function applyLink(url: string) {
  const r = pending ?? (selectionRanges()?.length === 1 ? selectionRanges()![0] : null);
  if (!url || !r) { report("링크: 대상 선택이 없습니다"); return; }
  if (!r.path.startsWith("d/")) { report("링크는 본문에서만 지원"); return; }
  edit(() => {
    const json = S.conv.set_hyperlink(r.path, r.start, r.end, url);
    S.caret = { path: r.path, off: r.end };
    S.sel = null;
    return json;
  });
  // Show the linked range so the change is visible.
  const a = refForOffset(r.path, r.start, false), b = refForOffset(r.path, r.end, true);
  if (a && b) { S.sel = orderSel(a, b); S.caret = null; drawCaret(); drawSelection(); }
  closeLinkBar();
}

// Remove the link the caret sits in (or the captured range's link).
export function removeLink() {
  const at = S.caret ? { path: S.caret.path, off: S.caret.off }
    : pending ? { path: pending.path, off: pending.start } : null;
  if (!at || !linkUrlAt(at.path, at.off)) { report("링크: 캐럿을 링크 위에 두세요"); return; }
  const keep = { ...at };
  edit(() => {
    const json = S.conv.remove_hyperlink(keep.path, keep.off);
    S.caret = keep;
    S.sel = null;
    return json;
  });
  closeLinkBar();
}

export function wireLink() {
  const q = linkq();
  q.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); applyLink(q.value.trim()); }
    else if (e.key === "Escape") { e.preventDefault(); closeLinkBar(); }
    e.stopPropagation();
  });
  document.getElementById("linkapply")!.onclick = () => applyLink(q.value.trim());
  document.getElementById("linkremove")!.onclick = removeLink;
  document.getElementById("linkclose")!.onclick = closeLinkBar;
}

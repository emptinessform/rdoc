// IME composition (Korean etc.): the hidden input that receives
// composition events, mirrored into the document as one undo unit.

import { S, chars } from "./state.js";
import { drawPreedit } from "./view.js";
import { edit, selRange, deleteSel } from "./edit.js";

export const imeEl = document.getElementById("ime") as HTMLInputElement;

function applyComp(data: string) {
  const comp = S.comp, caret = S.caret;
  if (!comp || !caret) return;
  edit(() => {
    const json = S.conv.replace_range(caret.path, comp.base, comp.base + comp.len, data);
    comp.len = chars(data).length;
    caret.off = comp.base + comp.len;
    return json;
  });
}

// Keep whatever preedit is on screen and close the undo unit — used when
// the user clicks away mid-composition. The IME's own later events find
// comp === null and do nothing; blur/refocus resets the OS composition.
export function finalizeComposition() {
  if (!S.comp) return;
  S.comp = null;
  S.conv.end_composition();
  imeEl.value = "";
  imeEl.blur();
  drawPreedit();
}

export function wireIme() {
  imeEl.addEventListener("compositionstart", () => {
    const r = selRange();
    S.conv.begin_composition(); // one undo unit: selection removal + preedit
    if (r) deleteSel();
    if (S.caret) S.comp = { base: S.caret.off, len: 0 };
    else S.conv.end_composition();
  });
  imeEl.addEventListener("compositionupdate", (e) => applyComp(e.data || ""));
  imeEl.addEventListener("compositionend", (e) => {
    applyComp(e.data || "");
    S.comp = null;
    imeEl.value = "";
    S.conv.end_composition();
    drawPreedit();
  });
}

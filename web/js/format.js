// Formatting and table structure: alignment, font size/color, paragraph
// styles, row/column ops, and Word-style Tab cell navigation.

import { S, chars } from "./state.js";
import { report } from "./render.js";
import { drawCaret, drawSelection, selectParaOffsets } from "./view.js";
import { edit, selRange, selectionRanges } from "./edit.js";

// Paragraph alignment for the caret paragraph or every paragraph the
// selection touches, as one history entry. Text is unchanged, so the
// caret survives; the selection is redrawn from its refs afterwards.
export function alignSelection(align) {
  let paths = [];
  const r = selRange();
  if (r && r.kind === "scatter") paths = [...new Set(r.ranges.map((x) => x.path))];
  else if (r && r.kind === "siblings") {
    const idx = (pp) => +pp.match(/(\d+)$/)[1];
    for (let i = idx(r.pa); i <= idx(r.pb); i++)
      paths.push(r.pa.replace(/\d+$/, i));
  } else if (r) paths = [r.pa];
  else if (S.caret) paths = [S.caret.path];
  if (!paths.length) { report("정렬: 캐럿을 두거나 선택하세요"); return; }
  const keep = S.caret && { ...S.caret };
  const keepSel = S.sel && { a: { ...S.sel.a }, b: { ...S.sel.b } };
  edit(() => {
    const json = S.conv.set_alignment_paths(JSON.stringify(paths), align);
    S.caret = keep;
    return json;
  });
  if (keepSel) { S.sel = keepSel; drawSelection(); }
}

// Font size over the selection. Sizes reflow lines, so the selection's
// page refs go stale — collapse to a caret at the range start instead.
export function applyFontSize(pt) {
  if (!(pt >= 6 && pt <= 96)) return;
  const ranges = selectionRanges();
  if (!ranges || !ranges.length) { report("크기: 텍스트를 선택하세요"); return; }
  edit(() => {
    const json = S.conv.set_size_ranges(JSON.stringify(ranges), pt);
    S.caret = { path: ranges[0].path, off: ranges[0].start };
    S.sel = null;
    return json;
  });
}

// Text color over the selection. Color does not reflow, so the
// selection refs stay valid and are restored after the edit.
export function applyFontColor(hex) {
  const ranges = selectionRanges();
  if (!ranges || !ranges.length) { report("색: 텍스트를 선택하세요"); return; }
  const keepSel = S.sel && { a: { ...S.sel.a }, b: { ...S.sel.b } };
  edit(() => S.conv.set_color_ranges(JSON.stringify(ranges), hex));
  if (keepSel) { S.sel = keepSel; drawSelection(); report(); }
}

// Paragraph style for the caret paragraph / selected paragraphs.
export function styleSelection(styleId) {
  let paths = [];
  const r = selRange();
  if (r && r.kind === "scatter") paths = [...new Set(r.ranges.map((x) => x.path))];
  else if (r && r.kind === "siblings") {
    const idx = (pp) => +pp.match(/(\d+)$/)[1];
    for (let i = idx(r.pa); i <= idx(r.pb); i++) paths.push(r.pa.replace(/\d+$/, i));
  } else if (r) paths = [r.pa];
  else if (S.caret) paths = [S.caret.path];
  if (!paths.length) { report("스타일: 캐럿을 두세요"); return; }
  const keep = S.caret && { ...S.caret };
  edit(() => {
    const json = S.conv.set_style_paths(JSON.stringify(paths), styleId);
    S.caret = keep;
    return json;
  });
}

// Table structure ops act on the caret's cell (top-level tables).
export function tableOp(op) {
  if (!S.caret || !/^d\/\d+\.\d+\.\d+\.\d+$/.test(S.caret.path)) {
    report("표 셀에 캐럿을 두세요");
    return;
  }
  const keep = { ...S.caret };
  edit(() => {
    const json = S.conv.table_op(keep.path, op);
    S.caret = op === "R" || op === "C" ? null : keep;
    S.sel = null;
    return json;
  });
}

// Word-style Tab in a table: move to the next/previous cell selecting its
// content; Tab at the last cell appends a row (via the structure op).
function landInCell(t, r, c) {
  const path = `d/${t}.${r}.${c}.0`;
  const text = S.conv.paragraph_text_at(path);
  if (text == null) return false;
  const len = chars(text).length;
  if (len > 0 && selectParaOffsets(path, 0, len)) { report(); return true; }
  S.caret = { path, off: 0 };
  S.sel = null;
  drawSelection();
  drawCaret();
  report();
  return true;
}

function lastColOf(t, r) {
  let c = 0;
  while (S.conv.paragraph_text_at(`d/${t}.${r}.${c + 1}.0`) != null) c++;
  return c;
}

export function tabCell(path, dir) {
  const m = path && path.match(/^d\/(\d+)\.(\d+)\.(\d+)\.\d+$/);
  if (!m) return false;
  const [t, r, c] = [+m[1], +m[2], +m[3]];
  if (dir > 0) {
    if (landInCell(t, r, c + 1) || landInCell(t, r + 1, 0)) return true;
    // Last cell: append a row, then land in it.
    const keep = S.caret ? { ...S.caret } : { path, off: 0 };
    edit(() => {
      const json = S.conv.table_op(path, "r");
      S.caret = keep;
      return json;
    });
    return landInCell(t, r + 1, 0);
  }
  if (c > 0) return landInCell(t, r, c - 1);
  if (r > 0) return landInCell(t, r - 1, lastColOf(t, r - 1));
  return true; // first cell: stay (Word keeps the caret there)
}

export function wireFormat() {
  document.querySelectorAll("#alignbtns button").forEach((b) => {
    b.onclick = () => alignSelection(b.dataset.align);
  });

  document.querySelectorAll("#tblbtns button").forEach((b) => {
    b.onclick = () => tableOp(b.dataset.op);
  });

  const fontcolorEl = document.getElementById("fontcolor");
  fontcolorEl.addEventListener("change", () => {
    applyFontColor(fontcolorEl.value.replace("#", "").toUpperCase());
  });

  const fontsizeEl = document.getElementById("fontsize");
  fontsizeEl.addEventListener("change", () => {
    applyFontSize(+fontsizeEl.value);
    fontsizeEl.blur();
  });
  fontsizeEl.addEventListener("keydown", (e) => e.stopPropagation());

  const parastyleEl = document.getElementById("parastyle");
  parastyleEl.addEventListener("change", () => {
    if (parastyleEl.value) styleSelection(parastyleEl.value);
    parastyleEl.selectedIndex = 0;
    parastyleEl.blur();
  });
}

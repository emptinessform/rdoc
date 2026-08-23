// Formatting and table structure: alignment, font size/color, paragraph
// styles, row/column ops, and Word-style Tab cell navigation.

import { S, chars, orderSel } from "./state.js";
import { report } from "./render.js";
import { drawCaret, drawSelection, selectParaOffsets, refForOffset } from "./view.js";
import { edit, selRange, selectionRanges, toggleFmt } from "./edit.js";

// Paragraph alignment for the caret paragraph or every paragraph the
// selection touches, as one history entry. Text is unchanged, so the
// caret survives; the selection is redrawn from its refs afterwards.
export function alignSelection(align: string) {
  let paths: string[] = [];
  const r = selRange();
  if (r && r.kind === "scatter") paths = [...new Set(r.ranges.map((x) => x.path))];
  else if (r && r.kind === "siblings") {
    const idx = (pp: string) => +pp.match(/(\d+)$/)![1];
    for (let i = idx(r.pa); i <= idx(r.pb); i++)
      paths.push(r.pa.replace(/\d+$/, String(i)));
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
export function applyFontSize(pt: number) {
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

// Font family over the selection. A family change reflows lines, so the
// selection collapses to a caret at the range start, like font size.
export function applyFontFamily(family: string) {
  const ranges = selectionRanges();
  if (!ranges || !ranges.length) { report("글꼴: 텍스트를 선택하세요"); return; }
  edit(() => {
    const json = S.conv.set_family_ranges(JSON.stringify(ranges), family);
    S.caret = { path: ranges[0].path, off: ranges[0].start };
    S.sel = null;
    return json;
  });
}

// Text color over the selection. Color does not reflow, but splitting
// runs renumbers the hit segments, so the old {page,idx,k} refs go
// stale — re-derive the selection from document offsets instead.
export function applyFontColor(hex: string) {
  const ranges = selectionRanges();
  if (!ranges || !ranges.length) { report("색: 텍스트를 선택하세요"); return; }
  const first = ranges[0], last = ranges[ranges.length - 1];
  edit(() => S.conv.set_color_ranges(JSON.stringify(ranges), hex));
  const a = refForOffset(first.path, first.start, false);
  const b = refForOffset(last.path, last.end, true);
  if (a && b) {
    S.sel = orderSel(a, b);
    drawSelection();
    report();
  }
}

// Paragraph style for the caret paragraph / selected paragraphs.
export function styleSelection(styleId: string) {
  let paths: string[] = [];
  const r = selRange();
  if (r && r.kind === "scatter") paths = [...new Set(r.ranges.map((x) => x.path))];
  else if (r && r.kind === "siblings") {
    const idx = (pp: string) => +pp.match(/(\d+)$/)![1];
    for (let i = idx(r.pa); i <= idx(r.pb); i++) paths.push(r.pa.replace(/\d+$/, String(i)));
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

/// Direct run formatting reported by wasm caret_format.
interface CaretFormat {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  size: number | null;
  family: string | null;
  color: string | null;
}

// Reflect the caret/selection formatting in the toolbar: B/I/U pressed
// state, and the font family/size fields. Called from report(), which
// every caret/selection/edit path already goes through.
export function updateToolbarState() {
  let fmt: CaretFormat | null = null;
  let biu: { b: boolean; i: boolean; u: boolean } | null = null;
  try {
    if (S.caret) {
      fmt = JSON.parse(S.conv.caret_format(S.caret.path, S.caret.off)) as CaretFormat;
      biu = { b: fmt.bold, i: fmt.italic, u: fmt.underline };
    } else {
      const ranges = selectionRanges();
      if (ranges && ranges.length) {
        const json = JSON.stringify(ranges);
        biu = {
          b: S.conv.ranges_format_on(json, "b"),
          i: S.conv.ranges_format_on(json, "i"),
          u: S.conv.ranges_format_on(json, "u"),
        };
        const first = ranges[0];
        fmt = JSON.parse(
          S.conv.caret_format(first.path, Math.min(first.start + 1, first.end)),
        ) as CaretFormat;
      }
    }
  } catch (e) { /* no document, or a non-editable spot: clear the state */ }

  document.querySelectorAll<HTMLButtonElement>("#fmtbtns button").forEach((b) => {
    const key = b.dataset.fmt as "b" | "i" | "u";
    b.classList.toggle("on", !!(biu && biu[key]));
  });
  const sizeEl = document.getElementById("fontsize") as HTMLInputElement;
  if (document.activeElement !== sizeEl) {
    sizeEl.value = fmt && fmt.size != null ? String(fmt.size) : "";
  }
  const famEl = document.getElementById("fontfamily") as HTMLSelectElement;
  if (document.activeElement !== famEl) {
    const family = fmt && fmt.family;
    famEl.value = family ?? "";
    if (famEl.value !== (family ?? "")) famEl.selectedIndex = 0; // not in the list
    if (!family) famEl.selectedIndex = 0;
  }
}

// Table structure ops act on the caret's cell (top-level tables).
export function tableOp(op: string) {
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
function landInCell(t: number, r: number, c: number): boolean {
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

function lastColOf(t: number, r: number): number {
  let c = 0;
  while (S.conv.paragraph_text_at(`d/${t}.${r}.${c + 1}.0`) != null) c++;
  return c;
}

export function tabCell(path: string | null | undefined, dir: number): boolean {
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
  document.querySelectorAll<HTMLButtonElement>("#fmtbtns button").forEach((b) => {
    b.onclick = () => toggleFmt(b.dataset.fmt!);
  });

  document.querySelectorAll<HTMLButtonElement>("#alignbtns button").forEach((b) => {
    b.onclick = () => alignSelection(b.dataset.align!);
  });

  document.querySelectorAll<HTMLButtonElement>("#tblbtns button").forEach((b) => {
    b.onclick = () => tableOp(b.dataset.op!);
  });

  const fontcolorEl = document.getElementById("fontcolor") as HTMLInputElement;
  fontcolorEl.addEventListener("change", () => {
    applyFontColor(fontcolorEl.value.replace("#", "").toUpperCase());
  });

  const fontfamilyEl = document.getElementById("fontfamily") as HTMLSelectElement;
  fontfamilyEl.addEventListener("change", () => {
    if (fontfamilyEl.value) applyFontFamily(fontfamilyEl.value);
    fontfamilyEl.blur(); // updateToolbarState now owns the displayed value
  });

  const fontsizeEl = document.getElementById("fontsize") as HTMLInputElement;
  fontsizeEl.addEventListener("change", () => {
    applyFontSize(+fontsizeEl.value);
    fontsizeEl.blur();
  });
  fontsizeEl.addEventListener("keydown", (e) => e.stopPropagation());

  const parastyleEl = document.getElementById("parastyle") as HTMLSelectElement;
  parastyleEl.addEventListener("change", () => {
    if (parastyleEl.value) styleSelection(parastyleEl.value);
    parastyleEl.selectedIndex = 0;
    parastyleEl.blur();
  });
}

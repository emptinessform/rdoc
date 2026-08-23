// Bootstrap: wasm init, font injection, event wiring, load/save, and the
// deterministic window.__t hooks for automated testing.

import init, { SvgConverter } from "../pkg/rdoc_core.js";
import { S, chars, allHits, getRun, orderSel } from "./state.js";
import {
  status, apply, report, applyZoom, dirtyCount, thumbsState, wireRender,
} from "./render.js";
import { findHit, drawCaret, drawSelection, selectedText } from "./view.js";
import {
  selectionRanges, typeText, backspace, deleteSel, replaceSelWith, enterKey,
  mergePrev, toggleFmt, insertFootnote, deleteFootnote, insertEndnote,
  deleteEndnote, deleteNote, doUndo, doRedo,
} from "./edit.js";
import {
  alignSelection, applyFontSize, applyFontColor, applyFontFamily,
  styleSelection, tableOp, tabCell, toggleList, setListLevel,
  applyLineSpacing, mergeCells, splitCell, openTableBar, applyInsertTable,
  wireFormat,
} from "./format.js";
import {
  doPaste, insertImageBytes, selectImage, deleteSelectedImage, copySelection,
  cutSelection, wireClipboard,
} from "./clipboard.js";
import {
  openFind, closeFind, runFind, gotoFind, replaceCurrent, replaceAll,
  findState, findq, replq, wireFind,
} from "./find.js";
import { imeEl, wireIme } from "./ime.js";
import { clickAt, wireInput } from "./input.js";
import { wireMenu, toggleTrackedView } from "./menu.js";
import {
  toggleComments, openCommentBar, applyComment, removeCommentAtCaret,
  resolveCommentAtCaret, wireCommentBar,
} from "./comments.js";
import { applyLink, removeLink, openLinkBar, wireLink } from "./link.js";
import { wireColResize } from "./colresize.js";
import { cellSel, setCellSel, clearCellSel } from "./cellsel.js";

declare global {
  interface Window {
    /** Deterministic hooks for the browser test suites (web/tests/). */
    __t: Record<string, unknown>;
  }
}

await init();
S.conv = new SvgConverter();

// Open-font set (rhwp-style): free fonts (SIL OFL) serve the common
// Korean family names, so a document that asks for 굴림/바탕/궁서…
// shapes with a real font of the same class even where no local font
// exists (mobile, the public demo). Each font file is registered ONCE;
// the many document-facing names are byte-free aliases (add_font_alias),
// so relayouts never copy duplicated font data. A locally provided
// malgun.ttf (dev machine — MS license, never in the repo) keeps
// priority for its own names; unmatched names fall through to rdocx's
// bundled fallback fonts.
const SANS_ALIASES = [
  "맑은 고딕 Semilight",
  "굴림", "Gulim", "굴림체", "GulimChe", "돋움", "Dotum", "돋움체", "DotumChe",
  "새굴림", "New Gulim", "나눔고딕", "NanumGothic", "나눔바른고딕",
  "함초롬돋움", "HCR Dotum", "Apple SD Gothic Neo",
  "Noto Sans KR", "Noto Sans CJK KR", "본고딕",
];
const SERIF_ALIASES = [
  "나눔명조", "바탕", "Batang", "바탕체", "BatangChe",
  "명조", "신명조", "HY신명조", "휴먼명조", "함초롬바탕", "HCR Batang",
  "은바탕", "UnBatang", "Noto Serif KR", "Noto Serif CJK KR", "본명조",
  // Script faces have no open equivalent; a serif is the closest class.
  "궁서", "Gungsuh", "궁서체", "GungsuhChe",
];
// Bold weights ride along under the same family name — fontdb reads the
// actual weight from each file, so bold runs resolve to the real bold
// face; styles with no face (e.g. Korean italic) get synthetic rendering
// in the SVG backend.
const FONT_SOURCES = [
  { url: "./malgun.ttf", family: "Malgun Gothic" },
  { url: "./fonts/Pretendard-Regular.otf", family: "Pretendard" },
  { url: "./fonts/Pretendard-Bold.otf", family: "Pretendard" },
  { url: "./fonts/NanumMyeongjo-Regular.ttf", family: "NanumMyeongjo" },
  { url: "./fonts/NanumMyeongjo-Bold.ttf", family: "NanumMyeongjo" },
];
async function loadFonts() {
  const fetched = await Promise.all(FONT_SOURCES.map(async (src) => {
    try {
      const res = await fetch(src.url);
      if (!res.ok) return null;
      return { family: src.family, bytes: new Uint8Array(await res.arrayBuffer()) };
    } catch (e) { return null; }
  }));
  const loaded = new Set<string>();
  for (const f of fetched) {
    if (!f) continue;
    S.conv.add_font(f.family, f.bytes);
    loaded.add(f.family.toLowerCase());
  }
  const taken = new Set<string>(loaded);
  const alias = (name: string, target: string | null) => {
    if (!target || taken.has(name.toLowerCase())) return;
    S.conv.add_font_alias(name, target);
    taken.add(name.toLowerCase());
  };
  const sans = loaded.has("pretendard") ? "Pretendard" : null;
  const serif = loaded.has("nanummyeongjo") ? "NanumMyeongjo" : sans;
  const malgun = loaded.has("malgun gothic") ? "Malgun Gothic" : sans;
  alias("Malgun Gothic", malgun); // no-op when the real file loaded
  alias("맑은 고딕", malgun);
  for (const name of SANS_ALIASES) alias(name, sans);
  for (const name of SERIF_ALIASES) alias(name, serif);
}
await loadFonts();
status("ready — load the demo or open a .docx");

// First visit shows a document, not an empty gray page: load the
// built-in demo right away (the demo button reloads it fresh, so the
// test suites' explicit clicks stay deterministic).
{
  S.conv.load_demo();
  const t0 = performance.now();
  apply(S.conv.render(), performance.now() - t0);
}

wireRender();
wireFind();
wireClipboard();
wireFormat();
wireIme();
wireInput();
wireMenu();
wireLink();
wireCommentBar();
wireColResize();

// ---- load ------------------------------------------------------------------

document.getElementById("demo")!.onclick = () => {
  if (S.trackedView) toggleTrackedView(false);
  S.conv.load_demo();
  const t = performance.now();
  apply(S.conv.render(), performance.now() - t);
};

document.getElementById("save")!.onclick = () => {
  try {
    const bytes = S.conv.save_docx();
    const blob = new Blob([bytes as unknown as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "rdoc-edited.docx";
    a.click();
    URL.revokeObjectURL(a.href);
    report(`saved ${bytes.length} bytes`);
  } catch (err) {
    report(`save error: ${err}`);
  }
};

const fileEl = document.getElementById("file") as HTMLInputElement;
fileEl.onchange = async () => {
  const f = fileEl.files && fileEl.files[0];
  fileEl.value = "";
  if (!f) return;
  try {
    if (S.trackedView) toggleTrackedView(false);
    S.conv.load_docx(new Uint8Array(await f.arrayBuffer()));
    const t = performance.now();
    apply(S.conv.render(), performance.now() - t);
  } catch (err) {
    status(`열기 실패: ${f.name} — ${err}`);
  }
};

// Deterministic hooks for automated testing.
window.__t = {
  clickAt,
  type: typeText,
  backspace: () => {
    if (S.caret && S.caret.off === 0) mergePrev();
    else backspace();
  },
  enter: enterKey,
  deleteSel,
  replaceSel: replaceSelWith,
  toggle: toggleFmt,
  undo: doUndo,
  redo: doRedo,
  paraTexts: () => S.conv.paragraph_texts(),
  textAt: (p: string) => S.conv.paragraph_text_at(p),
  pathOrder: (p: string) => S.conv.path_order(p),
  saveDocx: () => S.conv.save_docx(),
  insertFootnote,
  deleteFootnote,
  insertEndnote,
  deleteEndnote,
  deleteNote,
  loadBytes: (bytes: Uint8Array) => {
    S.conv.load_docx(bytes);
    const t0 = performance.now();
    S.caret = null; S.sel = null;
    apply(S.conv.render(), performance.now() - t0);
  },
  simIme: (steps: string[]) => {
    imeEl.focus();
    imeEl.dispatchEvent(new CompositionEvent("compositionstart"));
    for (const s of steps.slice(0, -1))
      imeEl.dispatchEvent(new CompositionEvent("compositionupdate", { data: s }));
    imeEl.dispatchEvent(new CompositionEvent("compositionend", { data: steps[steps.length - 1] }));
  },
  // Step-wise composition, so tests can inspect state between events.
  imeStart: () => {
    imeEl.focus();
    imeEl.dispatchEvent(new CompositionEvent("compositionstart"));
  },
  imeUpdate: (s: string) => imeEl.dispatchEvent(new CompositionEvent("compositionupdate", { data: s })),
  imeEnd: (s: string) => imeEl.dispatchEvent(new CompositionEvent("compositionend", { data: s })),
  select: (page: number, x1: number, y1: number, x2: number, y2: number) => {
    const p = findHit(page, x1, y1), q = findHit(page, x2, y2);
    if (!p || !q) return null;
    S.sel = orderSel(
      { page: p.hit.page, idx: p.hit.id, k: p.k },
      { page: q.hit.page, idx: q.hit.id, k: q.k },
    );
    S.caret = null;
    drawCaret(); drawSelection(); report();
    return selectedText();
  },
  copy: () => { copySelection(); return S.lastCopied; },
  cut: () => { cutSelection(); return S.lastCopied; },
  selText: selectedText,
  setZoom: (z: number) => { S.zoom = z; applyZoom(); },
  loadUrl: async (u: string) => {
    const b = new Uint8Array(await (await fetch(u)).arrayBuffer());
    S.conv.load_docx(b);
    const t = performance.now();
    apply(S.conv.render(), performance.now() - t);
  },
  hits: (page: number) => S.pageHits[page - 1] || [],
  dirtyCount,
  openFind,
  closeFind,
  findQuery: (q: string) => { findq.value = q; runFind(false); },
  findNext: () => gotoFind(1),
  findPrev: () => gotoFind(-1),
  replaceWith: (q: string) => { replq.value = q; replaceCurrent(); },
  replaceAllWith: (q: string) => { replq.value = q; replaceAll(); },
  paste: doPaste,
  align: alignSelection,
  tableOp,
  mergeCells,
  splitCell,
  insertTable: (rows: number, cols: number) => { openTableBar(); applyInsertTable(rows, cols); },
  tableGrid: (p: string) => JSON.parse(S.conv.table_grid_pt(p)),
  cellSel: () => cellSel(),
  selectCells: (page: number, table: number, r0: number, c0: number, r1: number, c1: number) =>
    setCellSel({ page, table, r0, c0, r1, c1 }),
  clearCellSel: () => clearCellSel(),
  setColWidth: (p: string, col: number, pt: number) => {
    const j = S.conv.set_table_column_width(p, col, pt);
    apply(j, 0);
  },
  tabCell: (dir: number) => tabCell(S.caret ? S.caret.path : S.sel ? getRun(S.sel.a)?.path ?? null : null, dir),
  setStyle: styleSelection,
  insertImage: insertImageBytes,
  selectImageAt: (k: number) => selectImage(document.querySelectorAll<SVGImageElement>("#pages svg image")[k]),
  imageSel: () => (S.imageSel ? S.imageSel.index : null),
  deleteImage: deleteSelectedImage,
  fontSize: applyFontSize,
  fontColor: applyFontColor,
  fontFamily: applyFontFamily,
  toggleList,
  listLevel: setListLevel,
  listInfo: (p: string) => S.conv.list_info(p),
  lineSpacing: applyLineSpacing,
  pageInfo: () => JSON.parse(S.conv.page_info()),
  trackChanges: (on: boolean) => toggleTrackedView(on),
  hasRevisions: () => S.conv.has_revisions(),
  toggleComments: (on?: boolean) => toggleComments(on),
  docStats: () => JSON.parse(S.conv.doc_stats()),
  acceptAll: () => { const j = S.conv.accept_all_revisions(); apply(j, 0); },
  rejectAll: () => { const j = S.conv.reject_all_revisions(); apply(j, 0); },
  commentList: () => JSON.parse(S.conv.comment_list()),
  commentSpans: () => JSON.parse(S.conv.comment_spans()),
  addComment: (text: string) => { openCommentBar(); applyComment(text); },
  removeComment: removeCommentAtCaret,
  resolveComment: resolveCommentAtCaret,
  setPaper: (w: number, h: number) => { const j = S.conv.set_paper(w, h); apply(j, 0); },
  setOrientation: (l: boolean) => { const j = S.conv.set_orientation(l); apply(j, 0); },
  setMargins: (t: number, r: number, b: number, l: number) => { const j = S.conv.set_margins_pt(t, r, b, l); apply(j, 0); },
  openLink: openLinkBar,
  setLink: applyLink,
  removeLink,
  linkAt: (p: string, o: number) => S.conv.hyperlink_at(p, o) ?? null,
  fmtOn: (ranges: unknown, f: string) => S.conv.ranges_format_on(JSON.stringify(ranges), f),
  thumbs: thumbsState,
  toggleThumbs: () => document.getElementById("thumbtoggle")!.click(),
  selRanges: selectionRanges,
  findState,
  state: () => ({
    caret: S.caret, sel: S.sel, lastMs: S.lastMs, lastDelta: S.lastDelta, zoom: S.zoom,
    mapped: allHits().filter((h) => h.path !== null).length,
    total: allHits().length,
  }),
};

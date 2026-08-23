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
  alignSelection, applyFontSize, applyFontColor, styleSelection, tableOp, tabCell,
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

await init();
S.conv = new SvgConverter();
try {
  const buf = await (await fetch("./malgun.ttf")).arrayBuffer();
  S.conv.add_font("Malgun Gothic", new Uint8Array(buf));
} catch (e) { /* Korean falls back to bundled fonts */ }
status("ready — load the demo or open a .docx");

wireRender();
wireFind();
wireClipboard();
wireFormat();
wireIme();
wireInput();

// ---- load ------------------------------------------------------------------

document.getElementById("demo").onclick = () => {
  S.conv.load_demo();
  const t = performance.now();
  apply(S.conv.render(), performance.now() - t);
};

document.getElementById("save").onclick = () => {
  try {
    const bytes = S.conv.save_docx();
    const blob = new Blob([bytes], {
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

document.getElementById("file").onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  S.conv.load_docx(new Uint8Array(await f.arrayBuffer()));
  const t = performance.now();
  apply(S.conv.render(), performance.now() - t);
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
  textAt: (p) => S.conv.paragraph_text_at(p),
  pathOrder: (p) => S.conv.path_order(p),
  saveDocx: () => S.conv.save_docx(),
  insertFootnote,
  deleteFootnote,
  insertEndnote,
  deleteEndnote,
  deleteNote,
  loadBytes: (bytes) => {
    S.conv.load_docx(bytes);
    const t0 = performance.now();
    S.caret = null; S.sel = null;
    apply(S.conv.render(), performance.now() - t0);
  },
  simIme: (steps) => {
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
  imeUpdate: (s) => imeEl.dispatchEvent(new CompositionEvent("compositionupdate", { data: s })),
  imeEnd: (s) => imeEl.dispatchEvent(new CompositionEvent("compositionend", { data: s })),
  select: (page, x1, y1, x2, y2) => {
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
  setZoom: (z) => { S.zoom = z; applyZoom(); },
  loadUrl: async (u) => {
    const b = new Uint8Array(await (await fetch(u)).arrayBuffer());
    S.conv.load_docx(b);
    const t = performance.now();
    apply(S.conv.render(), performance.now() - t);
  },
  hits: (page) => S.pageHits[page - 1] || [],
  dirtyCount,
  openFind,
  closeFind,
  findQuery: (q) => { findq.value = q; runFind(false); },
  findNext: () => gotoFind(1),
  findPrev: () => gotoFind(-1),
  replaceWith: (q) => { replq.value = q; replaceCurrent(); },
  replaceAllWith: (q) => { replq.value = q; replaceAll(); },
  paste: doPaste,
  align: alignSelection,
  tableOp,
  tabCell: (dir) => tabCell(S.caret ? S.caret.path : (S.sel && (getRun(S.sel.a) || {}).path), dir),
  setStyle: styleSelection,
  insertImage: insertImageBytes,
  selectImageAt: (k) => selectImage(document.querySelectorAll("#pages svg image")[k]),
  imageSel: () => (S.imageSel ? S.imageSel.index : null),
  deleteImage: deleteSelectedImage,
  fontSize: applyFontSize,
  fontColor: applyFontColor,
  fmtOn: (ranges, f) => S.conv.ranges_format_on(JSON.stringify(ranges), f),
  thumbs: thumbsState,
  toggleThumbs: () => document.getElementById("thumbtoggle").click(),
  selRanges: selectionRanges,
  findState,
  state: () => ({
    caret: S.caret, sel: S.sel, lastMs: S.lastMs, lastDelta: S.lastDelta, zoom: S.zoom,
    mapped: allHits().filter(h => h.path !== null).length,
    total: allHits().length,
  }),
};

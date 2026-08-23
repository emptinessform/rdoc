// User input: mouse (click/drag/double/triple-click, drag auto-scroll)
// and the global keyboard handler.

import { S, chars, getRun, orderSel } from "./state.js";
import { pagesEl, report } from "./render.js";
import {
  findHit, refAt, drawCaret, drawSelection, selectParaOffsets,
  lineEdgeOff, lineTarget,
} from "./view.js";
import {
  selRange, typeText, backspace, deleteSel, replaceSelWith, enterKey,
  mergePrev, forwardDelete, toggleFmt, insertFootnote, insertEndnote,
  deleteNote, doUndo, doRedo, caretToLineEdge, selectAll, moveCaretLine,
} from "./edit.js";
import { alignSelection, tabCell } from "./format.js";
import { copySelection, cutSelection, clearImageSel, selectImage, deleteSelectedImage } from "./clipboard.js";
import { openFind, openReplace, closeFind, isFindOpen, findq, replq } from "./find.js";
import { imeEl, finalizeComposition } from "./ime.js";

function svgPoint(svg, clientX, clientY) {
  return new DOMPoint(clientX, clientY).matrixTransform(svg.getScreenCTM().inverse());
}

let mouse = null;

function extendSelection(key) {
  // Establish anchor and focus from the caret or an existing selection.
  if (!S.selAnchor) {
    if (S.caret) {
      S.selAnchor = { ...S.caret };
      S.selFocus = { ...S.caret };
    } else if (S.sel) {
      const A = getRun(S.sel.a), B = getRun(S.sel.b);
      if (!A || !B || A.path === null || B.path === null) return;
      S.selAnchor = { path: A.path, off: A.start + S.sel.a.k };
      S.selFocus = { path: B.path, off: B.start + S.sel.b.k };
    } else return;
  }
  if (key === "ArrowLeft") S.selFocus = { ...S.selFocus, off: Math.max(0, S.selFocus.off - 1) };
  else if (key === "ArrowRight") {
    const len = chars(S.conv.paragraph_text_at(S.selFocus.path) || "").length;
    S.selFocus = { ...S.selFocus, off: Math.min(len, S.selFocus.off + 1) };
  } else if (key === "Home" || key === "End") {
    const off = lineEdgeOff(S.selFocus, key === "End");
    if (off !== null) S.selFocus = { ...S.selFocus, off };
  } else {
    const t = lineTarget(S.selFocus, key === "ArrowDown" ? +1 : -1);
    if (t) S.selFocus = t;
  }
  if (S.selAnchor.path === S.selFocus.path && S.selAnchor.off === S.selFocus.off) {
    S.sel = null;
    S.caret = { ...S.selFocus };
  } else {
    const a = refAt(S.selAnchor), b = refAt(S.selFocus);
    if (!a || !b) return;
    S.sel = orderSel(a, b);
    S.caret = null;
  }
  drawCaret();
  drawSelection();
  report();
}

// A non-shift arrow collapses an active selection to one of its edges.
function collapseSelection(toEnd) {
  const ref = toEnd ? S.sel.b : S.sel.a;
  const run = getRun(ref);
  S.sel = null;
  S.selAnchor = null;
  S.selFocus = null;
  if (run && run.path !== null) S.caret = { path: run.path, off: run.start + ref.k };
  drawCaret();
  drawSelection();
  report();
}

function extendDragTo(clientX, clientY) {
  const el = document.elementFromPoint(clientX, clientY);
  const svg = (el && el.closest("svg")) || mouse.svg;
  const page = [...pagesEl.children].indexOf(svg) + 1;
  const pt = svgPoint(svg, clientX, clientY);
  const found = findHit(page, pt.x, pt.y);
  if (!found) return;
  S.sel = orderSel(mouse.anchor, { page: found.hit.page, idx: found.hit.id, k: found.k });
  S.caret = null;
  drawCaret();
  drawSelection();
  report();
}

const SCROLL_EDGE = 28; // px from the viewport edge that triggers scrolling
function dragAutoScroll() {
  if (!mouse || !mouse.dragged) { mouse && (mouse.raf = null); return; }
  const y = mouse.lastY;
  const dy = y < SCROLL_EDGE ? y - SCROLL_EDGE
           : y > innerHeight - SCROLL_EDGE ? y - (innerHeight - SCROLL_EDGE) : 0;
  if (dy) {
    window.scrollBy(0, dy * 0.4);
    extendDragTo(mouse.lastX, mouse.lastY);
  }
  mouse.raf = requestAnimationFrame(dragAutoScroll);
}

export function clickAt(page, x, y) {
  finalizeComposition();
  clearImageSel();
  S.selAnchor = null;
  S.selFocus = null;
  S.sel = null;
  drawSelection();
  const found = findHit(page, x, y);
  if (!found) return;
  const { hit: h, k } = found;
  if (h.path === null) {
    S.caret = null;
    drawCaret();
    report(`segment ${JSON.stringify(h.text)} is decorative (marker/field) — not editable`);
    return;
  }

  S.caret = { path: h.path, off: h.start + k };
  drawCaret();
  report();
  imeEl.focus({ preventScroll: true });
}

export function wireInput() {
  pagesEl.addEventListener("mousedown", (e) => {
    const imgEl = e.target.closest && e.target.closest("image");
    if (imgEl) {
      e.preventDefault();
      selectImage(imgEl);
      mouse = null;
      return;
    }
    if (S.imageSel) clearImageSel();
    const svg = e.target.closest("svg");
    if (!svg) return;
    finalizeComposition();
    const page = [...pagesEl.children].indexOf(svg) + 1;
    const pt = svgPoint(svg, e.clientX, e.clientY);
    const found = findHit(page, pt.x, pt.y);
    if (e.detail >= 3 && found && found.hit.path !== null && found.hit.start !== null) {
      // Triple-click: select the whole paragraph under the cursor.
      const path = found.hit.path;
      const len = chars(S.conv.paragraph_text_at(path) || "").length;
      if (selectParaOffsets(path, 0, len)) report(`paragraph: ${path}`);
      mouse = { svg, page, start: { x: e.clientX, y: e.clientY }, anchor: null, dragged: false, tripled: true };
      return;
    }
    mouse = {
      svg, page,
      start: { x: e.clientX, y: e.clientY },
      anchor: found ? { page: found.hit.page, idx: found.hit.id, k: found.k } : null,
      dragged: false,
    };
  });

  pagesEl.addEventListener("mousemove", (e) => {
    if (!mouse || !mouse.anchor) return;
    if (!mouse.dragged && Math.hypot(e.clientX - mouse.start.x, e.clientY - mouse.start.y) < 4) return;
    mouse.dragged = true;
    mouse.lastX = e.clientX;
    mouse.lastY = e.clientY;
    if (!mouse.raf) mouse.raf = requestAnimationFrame(dragAutoScroll);
    extendDragTo(e.clientX, e.clientY);
  });

  pagesEl.addEventListener("dblclick", (e) => {
    const svg = e.target.closest("svg");
    if (!svg) return;
    const page = [...pagesEl.children].indexOf(svg) + 1;
    const pt = svgPoint(svg, e.clientX, e.clientY);
    const found = findHit(page, pt.x, pt.y);
    if (!found || found.hit.path === null || found.hit.start === null) return;
    const h = found.hit;
    const text = S.conv.paragraph_text_at(h.path) || "";
    const cs = chars(text);
    let off = Math.min(h.start + found.k, cs.length);
    if (off >= cs.length) off = cs.length - 1;
    if (off < 0) return;
    const isWord = (ch) => ch && !/\s/.test(ch);
    if (!isWord(cs[off])) return;
    let lo = off, hi = off + 1;
    while (lo > 0 && isWord(cs[lo - 1])) lo--;
    while (hi < cs.length && isWord(cs[hi])) hi++;
    if (selectParaOffsets(h.path, lo, hi))
      report(`word: ${JSON.stringify(cs.slice(lo, hi).join(""))}`);
  });

  window.addEventListener("mouseup", (e) => {
    if (!mouse) return;
    if (mouse.raf) cancelAnimationFrame(mouse.raf);
    if (mouse.tripled) { mouse = null; return; }
    if (!mouse.dragged) {
      const pt = svgPoint(mouse.svg, e.clientX, e.clientY);
      if (e.shiftKey && (S.caret || S.selAnchor)) {
        const found = findHit(mouse.page, pt.x, pt.y);
        if (found && found.hit.path !== null && found.hit.start !== null) {
          if (!S.selAnchor) S.selAnchor = { ...S.caret };
          S.selFocus = { path: found.hit.path, off: found.hit.start + found.k };
          const a = refAt(S.selAnchor), b = refAt(S.selFocus);
          if (a && b) {
            S.sel = orderSel(a, b);
            S.caret = null;
            drawCaret();
            drawSelection();
            report();
            mouse = null;
            return;
          }
        }
      }
      clickAt(mouse.page, pt.x, pt.y);
    }
    mouse = null;
  });

  document.addEventListener("keydown", (e) => {
    if (e.isComposing) return;
    if (e.target === findq || e.target === replq || e.target.id === "fontsize") return;
    if (S.imageSel) {
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteSelectedImage(); return; }
      if (e.key === "Escape") { e.preventDefault(); clearImageSel(); report(); return; }
    }
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (ctrl && !e.altKey && key === "f") { e.preventDefault(); openFind(); return; }
    if (ctrl && !e.altKey && key === "h") { e.preventDefault(); openReplace(); return; }
    if (e.key === "Escape" && isFindOpen()) { e.preventDefault(); closeFind(); return; }
    if (ctrl && key === "c") { e.preventDefault(); copySelection(); return; }
    if (ctrl && key === "x") { e.preventDefault(); cutSelection(); return; }
    if (ctrl && key === "a") { e.preventDefault(); selectAll(); return; }
    if (ctrl && key === "z" && !e.shiftKey) { e.preventDefault(); doUndo(); return; }
    if (ctrl && (key === "y" || (key === "z" && e.shiftKey))) { e.preventDefault(); doRedo(); return; }
    if (ctrl && e.altKey && key === "f") { e.preventDefault(); insertFootnote(); return; }
    if (ctrl && e.altKey && key === "e") { e.preventDefault(); insertEndnote(); return; }
    if (ctrl && e.altKey && key === "d") { e.preventDefault(); deleteNote(); return; }
    if (ctrl && (key === "b" || key === "i" || key === "u")) { e.preventDefault(); toggleFmt(key); return; }
    if (ctrl && !e.altKey && (key === "l" || key === "e" || key === "r")) {
      e.preventDefault();
      alignSelection(key === "l" ? "l" : key === "e" ? "c" : "r");
      return;
    }
    if (ctrl || e.altKey) return;
    if (e.key === "Tab") {
      const pos = S.caret ? S.caret.path : (S.sel && (getRun(S.sel.a) || {}).path) || null;
      if (pos && /^d\/\d+\.\d+\.\d+\.\d+$/.test(pos)) {
        e.preventDefault();
        tabCell(pos, e.shiftKey ? -1 : 1);
        return;
      }
    }
    if (e.key.length === 1) {
      e.preventDefault();
      if (selRange()) replaceSelWith(e.key);
      else if (S.caret) typeText(e.key);
    } else if (e.key === "Backspace") {
      e.preventDefault();
      if (selRange()) deleteSel();
      else if (S.caret && S.caret.off === 0) mergePrev();
      else if (S.caret) backspace();
    } else if (e.key === "Delete") {
      e.preventDefault();
      if (selRange()) deleteSel();
      else if (S.caret) forwardDelete();
    } else if (e.key === "Enter") {
      e.preventDefault();
      enterKey();
    } else if (e.key === "Home" && !e.shiftKey && S.caret) { e.preventDefault(); caretToLineEdge(false); }
    else if (e.key === "End" && !e.shiftKey && S.caret) { e.preventDefault(); caretToLineEdge(true); }
    else if (e.shiftKey && /^(Arrow(Left|Right|Up|Down)|Home|End)$/.test(e.key)) {
      e.preventDefault();
      extendSelection(e.key);
    }
    else if (e.key === "ArrowLeft" && S.sel) { e.preventDefault(); collapseSelection(false); }
    else if (e.key === "ArrowRight" && S.sel) { e.preventDefault(); collapseSelection(true); }
    else if (e.key === "ArrowLeft" && S.caret) { e.preventDefault(); S.caret.off = Math.max(0, S.caret.off - 1); drawCaret(); report(); }
    else if (e.key === "ArrowRight" && S.caret) { e.preventDefault(); S.caret.off += 1; drawCaret(); report(); }
    else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && S.caret) {
      e.preventDefault();
      moveCaretLine(e.key === "ArrowDown" ? +1 : -1);
    }
  });
}

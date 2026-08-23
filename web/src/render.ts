// Page rendering: apply deltas from wasm, lazy page drain, zoom, the
// thumbnail sidebar, and the status line.

import { S } from "./state.js";
import type { HitRun } from "./state.js";
import { drawCaret, drawSelection, drawPreedit } from "./view.js";
import { drawFindHl, refindAfterApply } from "./find.js";
import { drawCommentHl } from "./comments.js";
import { updateToolbarState } from "./format.js";

/** The JSON payload every wasm mutation/render returns. */
interface RenderDelta {
  total: number;
  changed: number[];
  hits: [number, HitRun[]][];
}

const statusEl = document.getElementById("status")!;
export const pagesEl = document.getElementById("pages")!;
export const status = (m: string) => statusEl.textContent = m;

export function applyZoom() {
  for (const svg of pagesEl.children as HTMLCollectionOf<SVGSVGElement>) {
    svg.style.width = (svg.viewBox.baseVal.width * S.zoom * (700 / 612)) + "px";
  }
}

// Changed pages are applied lazily: pages in (or near) the viewport get
// their SVG now; the rest go into a dirty set drained on idle time.
// page_svg always renders the *current* document, so a page that turns
// dirty across several edits is still correct when finally drained.
const dirtyPages = new Set<number>();
let drainScheduled = false;

export const dirtyCount = () => dirtyPages.size;

function applyPage(i: number) {
  const svg = S.conv.page_svg(i);
  const cur = pagesEl.children[i];
  if (cur) cur.outerHTML = svg;
  else pagesEl.insertAdjacentHTML("beforeend", svg);
  if (thumbsOpen()) { thumbDirty.add(i); scheduleThumbs(); }
}

function pageNearViewport(i: number): boolean {
  const el = pagesEl.children[i];
  if (!el) return true; // not in the DOM yet: apply now to keep indices aligned
  const r = el.getBoundingClientRect();
  return r.bottom > -innerHeight && r.top < 2 * innerHeight; // ±1 viewport
}

function drainDirty() {
  drainScheduled = false;
  const t0 = performance.now();
  for (const i of [...dirtyPages].sort((a, b) => a - b)) {
    applyPage(i);
    dirtyPages.delete(i);
    if (performance.now() - t0 > 8) break; // keep the tab responsive
  }
  if (dirtyPages.size) scheduleDrain();
  else { applyZoom(); drawFindHl(); drawCommentHl(); report(); }
}

function scheduleDrain() {
  if (drainScheduled) return;
  drainScheduled = true;
  if (window.requestIdleCallback) window.requestIdleCallback(drainDirty);
  else setTimeout(drainDirty, 30);
}

// ---- page thumbnails -------------------------------------------------------
// Sidebar minis are blob images of the page SVG strings already in the
// DOM, so no extra wasm rendering happens; changed pages re-blob on idle.
const thumbsEl = document.getElementById("thumbs")!;
const thumbDirty = new Set<number>();
let thumbTimer: ReturnType<typeof setTimeout> | null = null;

function thumbsOpen() { return !thumbsEl.hidden; }

export const thumbsState = () => ({
  open: !thumbsEl.hidden,
  count: thumbsEl.children.length,
  pending: thumbDirty.size,
  withSrc: [...thumbsEl.querySelectorAll("img")].filter((i) => i.src).length,
});

function refreshThumb(i: number) {
  const page = pagesEl.children[i];
  const img = thumbsEl.children[i] && thumbsEl.children[i].querySelector("img");
  if (!page || !img) return;
  const url = URL.createObjectURL(new Blob([page.outerHTML], { type: "image/svg+xml" }));
  const old = img.src;
  img.src = url;
  if (old) URL.revokeObjectURL(old);
}

function syncThumbCount() {
  const n = pagesEl.children.length;
  while (thumbsEl.children.length > n) thumbsEl.lastChild!.remove();
  while (thumbsEl.children.length < n) {
    const i = thumbsEl.children.length;
    const cell = document.createElement("div");
    const img = document.createElement("img");
    img.onclick = () => pagesEl.children[i] && pagesEl.children[i].scrollIntoView({ block: "start" });
    const no = document.createElement("div");
    no.className = "pageno";
    no.textContent = String(i + 1);
    cell.appendChild(img);
    cell.appendChild(no);
    thumbsEl.appendChild(cell);
    thumbDirty.add(i);
  }
}

function scheduleThumbs() {
  if (!thumbsOpen() || thumbTimer) return;
  thumbTimer = setTimeout(() => {
    thumbTimer = null;
    const t0 = performance.now();
    for (const i of [...thumbDirty].sort((a, b) => a - b)) {
      // A page still deferred in dirtyPages would blob stale content —
      // let the drain finish first and keep the thumb queued.
      if (dirtyPages.has(i)) continue;
      refreshThumb(i);
      thumbDirty.delete(i);
      if (performance.now() - t0 > 12) break;
    }
    if (thumbDirty.size) scheduleThumbs();
  }, 60);
}

export function apply(json: string, ms: number) {
  const out = JSON.parse(json) as RenderDelta;
  while (pagesEl.children.length > out.total) pagesEl.lastChild!.remove();
  for (const i of dirtyPages) if (i >= out.total) dirtyPages.delete(i);
  let drawnNow = 0;
  for (const i of out.changed) {
    if (pageNearViewport(i)) { applyPage(i); drawnNow++; dirtyPages.delete(i); }
    else dirtyPages.add(i);
  }
  if (dirtyPages.size) scheduleDrain();
  if (thumbsOpen()) { syncThumbCount(); scheduleThumbs(); }
  for (const [i, runs] of out.hits) S.pageHits[i] = runs;
  S.pageHits.length = out.total;
  S.lastMs = ms;
  S.lastDelta = `${drawnNow}/${out.total} pages redrawn` +
                (dirtyPages.size ? `, ${dirtyPages.size} deferred` : "");
  S.sel = null;
  S.imageSel = null; // page DOM replaced; outline went with it
  applyZoom();
  drawCaret();
  drawSelection();
  drawPreedit();
  refindAfterApply();
  drawCommentHl();
  report();
}

export function report(extra?: string) {
  const c = S.caret ? `caret: ${S.caret.path}, offset ${S.caret.off}` : (S.sel ? "selection" : "no caret");
  status(`${c} | last op ${S.lastMs.toFixed(1)} ms (${S.lastDelta})${extra ? " | " + extra : ""}`);
  updateToolbarState();
}

export function wireRender() {
  const zoomEl = document.getElementById("zoom") as HTMLSelectElement;
  zoomEl.onchange = () => { S.zoom = +zoomEl.value; applyZoom(); };

  document.getElementById("thumbtoggle")!.onclick = () => {
    thumbsEl.hidden = !thumbsEl.hidden;
    document.body.classList.toggle("thumbs-open", !thumbsEl.hidden);
    if (thumbsOpen()) {
      syncThumbCount();
      for (let i = 0; i < pagesEl.children.length; i++) thumbDirty.add(i);
      scheduleThumbs();
    }
  };

  // Scrolling toward a deferred page must never show stale content: drain
  // anything near the viewport immediately.
  window.addEventListener("scroll", () => {
    if (!dirtyPages.size) return;
    let drained = false;
    for (const i of [...dirtyPages]) {
      if (pageNearViewport(i)) { applyPage(i); dirtyPages.delete(i); drained = true; }
    }
    if (drained) applyZoom();
  }, { passive: true });
}

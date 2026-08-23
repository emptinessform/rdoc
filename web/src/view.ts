// View geometry: hit testing, offset<->coordinate mapping, and the SVG
// overlays (caret, selection rects, IME preedit underline), plus the
// text extraction used by copy.

import { S, chars, width, cum, allHits, cmpPos, orderSel, storyOf } from "./state.js";
import type { HitRun, Pos, Ref } from "./state.js";

/** A document position resolved to a concrete on-page hit run. */
export interface Vis { hit: HitRun; k: number }
import { pagesEl, scroller } from "./render.js";

export function findHit(page: number, x: number, y: number): Vis | null {
  let best: HitRun | null = null, bestScore = Infinity;
  for (const h of S.pageHits[page - 1] || []) {
    // Zero-advance hits are empty paragraphs: clickable, but real text
    // runs win when both are near (their spans cover actual distance).
    const dy = y < h.y - h.size ? (h.y - h.size) - y : (y > h.y + 0.3 * h.size ? y - (h.y + 0.3 * h.size) : 0);
    const x1 = h.x, x2 = h.x + width(h);
    const dx = x < x1 ? x1 - x : (x > x2 ? x - x2 : 0);
    const score = dy * 3 + dx;
    if (score < bestScore) { bestScore = score; best = h; }
  }
  if (!best) return null;
  let k = 0, cx = best.x;
  for (const a of best.adv) { if (x < cx + a / 2) break; cx += a; k++; }
  return { hit: best, k };
}

export function visFor(pos: Pos | null): Vis | null {
  if (!pos) return null;
  let best: Vis | null = null;
  for (const h of allHits()) {
    if (h.path !== pos.path || h.start === null) continue;
    const len = chars(h.text).length;
    if (pos.off >= h.start && pos.off <= h.start + len) {
      best = { hit: h, k: pos.off - h.start };
      if (pos.off < h.start + len) break;
    }
  }
  return best;
}

const caretVis = () => visFor(S.caret);

export function refAt(pos: Pos | null): Ref | null {
  const vis = visFor(pos);
  if (!vis) return null;
  return { page: vis.hit.page, idx: vis.hit.id, k: vis.k };
}

export function drawCaret() {
  document.querySelectorAll(".caret").forEach((n) => n.remove());
  const vis = caretVis();
  if (!vis) return;
  queueMicrotask(() => {
    // scrollIntoView is unreliable on SVG children; scroll explicitly.
    const el = document.querySelector(".caret");
    if (!el) return;
    const r = el.getBoundingClientRect();
    const m = scroller.getBoundingClientRect();
    if (r.top < m.top + 6 || r.bottom > m.bottom - 10) {
      scroller.scrollBy({ top: r.top - (m.top + m.height / 2), behavior: "instant" });
    }
  });
  const { hit: h, k } = vis;
  const svg = pagesEl.children[h.page - 1];
  if (!svg) return;
  const x = h.x + cum(h, k);
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", String(x)); line.setAttribute("x2", String(x));
  line.setAttribute("y1", String(h.y - 0.85 * h.size));
  line.setAttribute("y2", String(h.y + 0.25 * h.size));
  line.setAttribute("stroke", "#1a73e8");
  line.setAttribute("stroke-width", "0.8");
  line.setAttribute("class", "caret");
  svg.appendChild(line);
}

export function drawSelection() {
  document.querySelectorAll(".selrect").forEach((n) => n.remove());
  if (!S.sel) return;
  for (const h of allHits()) {
    const ref = { page: h.page, idx: h.id };
    if (cmpPos({ ...ref, k: h.adv.length }, S.sel.a) < 0 || cmpPos({ ...ref, k: 0 }, S.sel.b) > 0) continue;
    const sameA = h.page === S.sel.a.page && h.id === S.sel.a.idx;
    const sameB = h.page === S.sel.b.page && h.id === S.sel.b.idx;
    const k1 = sameA ? S.sel.a.k : 0;
    const k2 = sameB ? S.sel.b.k : h.adv.length;
    if (k2 <= k1) continue;
    const svg = pagesEl.children[h.page - 1];
    if (!svg) continue;
    const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    r.setAttribute("x", String(h.x + cum(h, k1)));
    r.setAttribute("y", String(h.y - 0.85 * h.size));
    r.setAttribute("width", String(cum(h, k2) - cum(h, k1)));
    r.setAttribute("height", String(1.1 * h.size));
    r.setAttribute("fill", "#1a73e8");
    r.setAttribute("opacity", "0.28");
    r.setAttribute("class", "selrect");
    svg.appendChild(r);
  }
}

// Underline the in-flight IME preedit, the visual convention for "not
// committed yet". Overlay-only: the document never carries the underline,
// so commit/cancel/undo need no formatting cleanup.
export function drawPreedit() {
  document.querySelectorAll(".preedit").forEach((n) => n.remove());
  if (!S.comp || S.comp.len === 0 || !S.caret) return;
  const from = S.comp.base, to = S.comp.base + S.comp.len;
  for (const h of allHits()) {
    if (h.path !== S.caret.path || h.start === null) continue;
    const len = chars(h.text).length;
    const k1 = Math.max(0, from - h.start);
    const k2 = Math.min(len, to - h.start);
    if (k2 <= k1) continue;
    const svg = pagesEl.children[h.page - 1];
    if (!svg) continue;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    const y = h.y + 0.16 * h.size;
    line.setAttribute("x1", String(h.x + cum(h, k1)));
    line.setAttribute("x2", String(h.x + cum(h, k2)));
    line.setAttribute("y1", String(y));
    line.setAttribute("y2", String(y));
    line.setAttribute("stroke", "#1a73e8");
    line.setAttribute("stroke-width", String(0.07 * h.size));
    line.setAttribute("class", "preedit");
    svg.appendChild(line);
  }
}

export function selectedText() {
  if (!S.sel) return "";
  let out = "", prev = null;
  for (const h of allHits()) {
    // Decorative runs (note markers, list bullets, generated page
    // numbers) have no source path; Word does not copy them as text.
    if (h.path === null) continue;
    const ref = { page: h.page, idx: h.id };
    const cs = chars(h.text);
    if (cmpPos({ ...ref, k: cs.length }, S.sel.a) < 0 || cmpPos({ ...ref, k: 0 }, S.sel.b) > 0) continue;
    const sameA = h.page === S.sel.a.page && h.id === S.sel.a.idx;
    const sameB = h.page === S.sel.b.page && h.id === S.sel.b.idx;
    const k1 = sameA ? S.sel.a.k : 0;
    const k2 = sameB ? S.sel.b.k : cs.length;
    if (k2 <= k1) continue;
    if (prev && prev.path !== h.path) out += "\n";
    out += cs.slice(k1, k2).join("");
    prev = h;
  }
  return out;
}

// Hit-ref for a character offset of one paragraph, on any of its lines.
export function refForOffset(path: string, offset: number, wantEnd: boolean): Ref | null {
  for (const cand of allHits()) {
    if (cand.path !== path || cand.start === null) continue;
    const lo = cand.start, hi = cand.start + chars(cand.text).length;
    if (offset >= lo && (offset < hi || (wantEnd && offset <= hi)))
      return { page: cand.page, idx: cand.id, k: offset - lo };
  }
  return null;
}

export function selectParaOffsets(path: string, lo: number, hi: number): boolean {
  const a = refForOffset(path, lo, false), b = refForOffset(path, hi, true);
  if (!a || !b) return false;
  S.sel = orderSel(a, b);
  S.caret = null;
  drawCaret(); drawSelection();
  return true;
}

// Home/End relative to a position's visual line: among hits of the same
// paragraph on the same baseline, the smallest or largest offset.
export function lineEdgeOff(pos: Pos, end: boolean): number | null {
  const vis = visFor(pos);
  if (!vis) return end ? chars(S.conv.paragraph_text_at(pos.path) || "").length : 0;
  const { hit: h } = vis;
  let bestOff: number | null = null;
  for (const cand of S.pageHits[h.page - 1] || []) {
    if (cand.path !== pos.path || cand.start === null) continue;
    if (Math.abs(cand.y - h.y) > 0.4 * h.size) continue;
    const lo = cand.start, hi = cand.start + chars(cand.text).length;
    const v = end ? hi : lo;
    if (bestOff === null || (end ? v > bestOff : v < bestOff)) bestOff = v;
  }
  return bestOff;
}

// The (path, off) one visual line above or below `pos`, or null. Only
// lines of the same story count: arrowing down from the last body line
// of a page skips headers/footers/notes and lands on the next page's body.
export function lineTarget(pos: Pos, dir: number): Pos | null {
  const vis = visFor(pos);
  if (!vis) return null;
  const { hit: h, k } = vis;
  const story = storyOf(h.path);
  const cx = h.x + cum(h, k);
  const half = 0.4 * h.size; // same-baseline tolerance
  let bestLine: number | null = null;
  const consider = (cand: HitRun, yRef: number) => {
    if (storyOf(cand.path) !== story) return;
    const dy = dir > 0 ? cand.y - yRef : yRef - cand.y;
    if (dy <= half) return; // same line or wrong direction
    if (bestLine === null || dy < bestLine - 1e-6) bestLine = dy;
  };
  // Pass 1: find the nearest baseline in the direction (same page first,
  // then the neighboring page treated as "beyond the edge").
  const pages = [h.page];
  if (dir > 0 && S.pageHits[h.page]) pages.push(h.page + 1);
  if (dir < 0 && h.page > 1) pages.push(h.page - 1);
  const yRefFor = (pg: number) => pg === h.page ? h.y : (dir > 0 ? -1e9 : 1e9);
  let target: HitRun | null = null;
  for (const pg of pages) {
    bestLine = null;
    for (const cand of S.pageHits[pg - 1] || []) consider(cand, yRefFor(pg));
    if (bestLine === null) continue;
    // Pass 2: on that baseline, nearest x.
    let best: { cand: HitRun; dx: number } | null = null;
    for (const cand of S.pageHits[pg - 1] || []) {
      if (storyOf(cand.path) !== story) continue;
      const dy = dir > 0 ? cand.y - yRefFor(pg) : yRefFor(pg) - cand.y;
      if (Math.abs(dy - bestLine) > half) continue;
      const x1 = cand.x, x2 = cand.x + width(cand);
      const dx = cx < x1 ? x1 - cx : cx > x2 ? cx - x2 : 0;
      if (best === null || dx < best.dx) best = { cand, dx };
    }
    if (best) { target = best.cand; break; }
  }
  if (!target || target.path === null) return null;
  if (!/^(d|h|f|fn|en)\//.test(target.path)) return null;
  let kk = 0, xx = target.x;
  for (const a of target.adv) { if (cx < xx + a / 2) break; xx += a; kk++; }
  return { path: target.path, off: (target.start ?? 0) + kk };
}

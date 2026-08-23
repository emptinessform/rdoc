// Find/replace bar (Ctrl+F / Ctrl+H). Paragraph-scoped, case-insensitive
// search over every rendered story. The current match becomes the live
// selection (typing replaces it, copy works); other matches get a light
// overlay redrawn after edits/drains.

import { S, chars, allHits, cum, orderSel } from "./state.js";
import { pagesEl, report } from "./render.js";
import { drawCaret, drawSelection, refForOffset } from "./view.js";
import { edit, replaceSelWith } from "./edit.js";
import type { ParaRange } from "./edit.js";
import { imeEl } from "./ime.js";

const findbar = document.getElementById("findbar")!;
export const findq = document.getElementById("findq") as HTMLInputElement;
const findcount = document.getElementById("findcount")!;
export const replq = document.getElementById("replq") as HTMLInputElement;
const FIND_HL_CAP = 500; // overlay rects only; count/cycling stay exact
let findMatches: ParaRange[] = []; // in document order
let findCur = -1;
let findDebounce: ReturnType<typeof setTimeout> | undefined;

export const isFindOpen = () => !findbar.hidden;
export const refindAfterApply = () => { if (!findbar.hidden) runFind(true); };
export const findState = () => ({
  open: !findbar.hidden,
  count: findMatches.length,
  cur: findCur,
  hl: document.querySelectorAll(".findhl").length,
});

function findParaOrder(): string[] {
  const seen = new Set<string>(), out: string[] = [];
  for (const h of allHits())
    if (h.path !== null && !seen.has(h.path)) { seen.add(h.path); out.push(h.path); }
  return out;
}

export function runFind(keepCur: boolean) {
  const q = findq.value;
  const prev = keepCur && findCur >= 0 ? findMatches[findCur] : null;
  findMatches = [];
  if (q) {
    const ql = q.toLowerCase();
    const qlen = chars(q).length;
    for (const path of findParaOrder()) {
      const text = S.conv.paragraph_text_at(path);
      if (text == null) continue;
      const low = text.toLowerCase();
      let idx = low.indexOf(ql);
      while (idx !== -1) {
        const start = chars(text.slice(0, idx)).length;
        findMatches.push({ path, start, end: start + qlen });
        idx = low.indexOf(ql, idx + ql.length); // non-overlapping, like Word
      }
    }
  }
  findCur = prev
    ? findMatches.findIndex((m) => m.path === prev.path && m.start === prev.start)
    : -1;
  findcount.textContent = q ? `${findCur + 1 || "–"}/${findMatches.length}` : "";
  drawFindHl();
}

export function drawFindHl() {
  document.querySelectorAll(".findhl").forEach((n) => n.remove());
  if (findbar.hidden || !findMatches.length) return;
  const byPath = new Map<string, import("./state.js").HitRun[]>();
  for (const h of allHits()) {
    if (h.path === null || h.start === null) continue;
    let a = byPath.get(h.path);
    if (!a) { a = []; byPath.set(h.path, a); }
    a.push(h);
  }
  for (let m = 0; m < Math.min(findMatches.length, FIND_HL_CAP); m++) {
    if (m === findCur) continue; // the current match is the live selection
    const { path, start, end } = findMatches[m];
    for (const h of byPath.get(path) || []) {
      const hs = h.start!; // byPath only holds runs with provenance
      const k1 = Math.max(start, hs) - hs;
      const k2 = Math.min(end, hs + h.adv.length) - hs;
      if (k2 <= k1) continue;
      const svg = pagesEl.children[h.page - 1];
      if (!svg) continue;
      const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      r.setAttribute("x", String(h.x + cum(h, k1)));
      r.setAttribute("y", String(h.y - 0.85 * h.size));
      r.setAttribute("width", String(cum(h, k2) - cum(h, k1)));
      r.setAttribute("height", String(1.1 * h.size));
      r.setAttribute("fill", "#f9ab00");
      r.setAttribute("opacity", "0.35");
      r.setAttribute("class", "findhl");
      svg.appendChild(r);
    }
  }
}

export function gotoFind(dir: number) {
  if (!findMatches.length) return;
  findCur = ((findCur + dir) % findMatches.length + findMatches.length) % findMatches.length;
  const m = findMatches[findCur];
  const a = refForOffset(m.path, m.start, false), b = refForOffset(m.path, m.end, true);
  if (a && b) {
    S.sel = orderSel(a, b);
    S.caret = null;
    S.selAnchor = null;
    S.selFocus = null;
    drawCaret();
    drawSelection();
  }
  findcount.textContent = `${findCur + 1}/${findMatches.length}`;
  drawFindHl();
  const r0 = document.querySelector(".selrect");
  if (r0) {
    const rc = r0.getBoundingClientRect();
    if (rc.top < 0 || rc.bottom > innerHeight)
      window.scrollBy({ top: rc.top - innerHeight / 2 });
  }
  report(`찾기 ${findCur + 1}/${findMatches.length}`);
}

export function openFind() {
  findbar.hidden = false;
  findq.focus();
  findq.select();
  runFind(true);
}

export function openReplace() {
  findbar.hidden = false;
  runFind(true);
  replq.focus();
  replq.select();
}

export function closeFind() {
  findbar.hidden = true;
  findMatches = [];
  findCur = -1;
  findcount.textContent = "";
  drawFindHl();
  imeEl.focus({ preventScroll: true });
}

// Replace the current match, then advance to the next match at or after
// the replacement site (apply() reruns the search, so indices are fresh).
export function replaceCurrent() {
  if (findCur < 0) { gotoFind(1); return; }
  const m = findMatches[findCur];
  const order = findParaOrder();
  const before = { para: order.indexOf(m.path), start: m.start };
  replaceSelWith(replq.value); // one history entry; apply() reran the find
  if (!findMatches.length) return;
  let next = findMatches.findIndex((c) => {
    const pi = order.indexOf(c.path);
    return pi > before.para || (pi === before.para && c.start >= before.start);
  });
  if (next === -1) next = 0;
  findCur = next - 1; // so gotoFind(+1) lands exactly on `next`
  gotoFind(1);
}

// Replace every match as one history entry (single undo).
export function replaceAll() {
  if (!findMatches.length) return;
  const n = findMatches.length;
  edit(() => {
    const json = S.conv.replace_all(JSON.stringify(findMatches), replq.value);
    S.caret = null;
    S.sel = null;
    return json;
  });
  report(`모두 바꾸기: ${n}건`);
}

export function wireFind() {
  findq.addEventListener("input", () => {
    clearTimeout(findDebounce);
    findDebounce = setTimeout(() => runFind(false), 150);
  });
  findq.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      clearTimeout(findDebounce);
      runFind(true);
      gotoFind(e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeFind();
    }
    e.stopPropagation();
  });
  document.getElementById("findprev")!.onclick = () => gotoFind(-1);
  document.getElementById("findnext")!.onclick = () => gotoFind(1);
  document.getElementById("findclose")!.onclick = closeFind;

  replq.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); replaceCurrent(); }
    else if (e.key === "Escape") { e.preventDefault(); closeFind(); }
    e.stopPropagation();
  });
  document.getElementById("replone")!.onclick = replaceCurrent;
  document.getElementById("replall")!.onclick = replaceAll;
}

// Table move / resize handles (Word convention): hovering a table shows
// a move handle above its top-left corner and a resize handle below its
// bottom-right corner. Dragging the resize handle scales every column
// proportionally; dragging the move handle drops the table at another
// top-level body position. Both commit as one history entry.

import { S } from "./state.js";
import { pagesEl, report } from "./render.js";
import { edit } from "./edit.js";
import { tableGeom, tablesOnPage } from "./tablegeo.js";
import type { TableGeom } from "./tablegeo.js";

const HANDLE_PT = 9;   // handle square size
const HOVER_PAD = 16;  // bbox padding that keeps handles alive while hovering

interface Shown { page: number; table: number; g: TableGeom; svg: SVGSVGElement }
let shown: Shown | null = null;

type Drag =
  | { kind: "resize"; s: Shown; startX: number; ghost: SVGRectElement }
  | { kind: "move"; s: Shown; line: SVGLineElement; to: number | null };
let drag: Drag | null = null;

export const isTableHandleDrag = () => drag !== null;

function ptOf(svg: SVGSVGElement, clientX: number, clientY: number) {
  return new DOMPoint(clientX, clientY).matrixTransform(svg.getScreenCTM()!.inverse());
}

function moveRect(g: TableGeom) {
  return { x: g.leftPt - HANDLE_PT - 3, y: g.yTop - HANDLE_PT - 3, w: HANDLE_PT, h: HANDLE_PT };
}
function sizeRect(g: TableGeom) {
  return { x: g.colX[g.colX.length - 1] + 2, y: g.yBottom + 2, w: HANDLE_PT, h: HANDLE_PT };
}

function hideHandles() {
  document.querySelectorAll(".tblhandle").forEach((n) => n.remove());
  shown = null;
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS("http://www.w3.org/2000/svg", tag);
}

function showHandles(page: number, table: number, g: TableGeom, svg: SVGSVGElement) {
  if (shown && shown.page === page && shown.table === table) { shown.g = g; return; }
  hideHandles();
  const mk = (r: { x: number; y: number; w: number; h: number }, cls: string, cursor: string) => {
    const rect = svgEl("rect");
    rect.setAttribute("x", String(r.x));
    rect.setAttribute("y", String(r.y));
    rect.setAttribute("width", String(r.w));
    rect.setAttribute("height", String(r.h));
    rect.setAttribute("rx", "1.5");
    rect.setAttribute("fill", "#fff");
    rect.setAttribute("stroke", "#1a73e8");
    rect.setAttribute("stroke-width", "0.7");
    rect.setAttribute("class", `tblhandle ${cls}`);
    rect.setAttribute("style", `cursor:${cursor}`);
    svg.appendChild(rect);
    return r;
  };
  const m = mk(moveRect(g), "tblhandle-move", "move");
  // Cross glyph inside the move handle.
  const cx = m.x + m.w / 2, cy = m.y + m.h / 2, a = m.w * 0.3;
  for (const [x1, y1, x2, y2] of [[cx - a, cy, cx + a, cy], [cx, cy - a, cx, cy + a]]) {
    const l = svgEl("line");
    l.setAttribute("x1", String(x1)); l.setAttribute("y1", String(y1));
    l.setAttribute("x2", String(x2)); l.setAttribute("y2", String(y2));
    l.setAttribute("stroke", "#1a73e8");
    l.setAttribute("stroke-width", "0.9");
    l.setAttribute("class", "tblhandle");
    l.setAttribute("style", "cursor:move;pointer-events:none");
    svg.appendChild(l);
  }
  mk(sizeRect(g), "tblhandle-size", "nwse-resize");
  shown = { page, table, g, svg };
}

const inRect = (p: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }) =>
  p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

// Top-level body items rendered on a page: body index -> y extent.
// Boundaries between consecutive items are the legal drop positions.
function bodyItemsOnPage(page: number): { index: number; top: number; bottom: number }[] {
  const map = new Map<number, { top: number; bottom: number }>();
  for (const h of S.pageHits[page - 1] ?? []) {
    const m = h.path?.match(/^d\/(\d+)/);
    if (!m) continue;
    const i = +m[1];
    const top = h.y - h.size, bottom = h.y + 0.35 * h.size;
    const cur = map.get(i);
    map.set(i, cur
      ? { top: Math.min(cur.top, top), bottom: Math.max(cur.bottom, bottom) }
      : { top, bottom });
  }
  return [...map.entries()]
    .map(([index, e]) => ({ index, ...e }))
    .sort((a, b) => a.index - b.index);
}

// The drop position for a pointer y: a body index to insert BEFORE, or
// (last index + 1) to append; plus the y to draw the insertion line at.
function dropTarget(page: number, yPt: number): { before: number; lineY: number } | null {
  const items = bodyItemsOnPage(page);
  if (!items.length) return null;
  for (const it of items) {
    if (yPt < (it.top + it.bottom) / 2) return { before: it.index, lineY: it.top - 2 };
  }
  const last = items[items.length - 1];
  return { before: last.index + 1, lineY: last.bottom + 2 };
}

export function wireTableHandles() {
  // Capture phase: a handle grab must win over the caret mousedown.
  pagesEl.addEventListener("mousedown", (e) => {
    if (!shown) return;
    const pt = ptOf(shown.svg, e.clientX, e.clientY);
    const g = shown.g;
    if (inRect(pt, sizeRect(g))) {
      e.preventDefault();
      e.stopPropagation();
      const ghost = svgEl("rect");
      ghost.setAttribute("x", String(g.leftPt));
      ghost.setAttribute("y", String(g.yTop));
      ghost.setAttribute("width", String(g.colX[g.colX.length - 1] - g.leftPt));
      ghost.setAttribute("height", String(g.yBottom - g.yTop));
      ghost.setAttribute("fill", "none");
      ghost.setAttribute("stroke", "#1a73e8");
      ghost.setAttribute("stroke-width", "0.8");
      ghost.setAttribute("stroke-dasharray", "3 2");
      ghost.setAttribute("class", "tblghost");
      shown.svg.appendChild(ghost);
      drag = { kind: "resize", s: shown, startX: pt.x, ghost };
      return;
    }
    if (inRect(pt, moveRect(g))) {
      e.preventDefault();
      e.stopPropagation();
      const line = svgEl("line");
      line.setAttribute("x1", String(g.leftPt));
      line.setAttribute("x2", String(g.colX[g.colX.length - 1]));
      line.setAttribute("y1", String(g.yTop - 2));
      line.setAttribute("y2", String(g.yTop - 2));
      line.setAttribute("stroke", "#1a73e8");
      line.setAttribute("stroke-width", "1.4");
      line.setAttribute("class", "tblghost");
      shown.svg.appendChild(line);
      drag = { kind: "move", s: shown, line, to: null };
    }
  }, { capture: true });

  window.addEventListener("mousemove", (e) => {
    if (drag) {
      const svg = drag.s.svg;
      const pt = ptOf(svg, e.clientX, e.clientY);
      if (drag.kind === "resize") {
        const g = drag.s.g;
        const right = Math.max(g.leftPt + 40, g.colX[g.colX.length - 1] + (pt.x - drag.startX));
        drag.ghost.setAttribute("width", String(right - g.leftPt));
      } else {
        const t = dropTarget(drag.s.page, pt.y);
        drag.to = t ? t.before : null;
        if (t) {
          drag.line.setAttribute("y1", String(t.lineY));
          drag.line.setAttribute("y2", String(t.lineY));
        }
      }
      return;
    }
    // Hover: show handles for the table whose padded bbox contains the
    // pointer (and keep them while the pointer is on a handle itself).
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const svg = el && (el.closest("svg") as SVGSVGElement | null);
    if (!svg || !pagesEl.contains(svg)) { hideHandles(); return; }
    const page = [...pagesEl.children].indexOf(svg) + 1;
    const pt = ptOf(svg, e.clientX, e.clientY);
    for (const table of tablesOnPage(page)) {
      const g = tableGeom(page, table);
      if (!g) continue;
      const right = g.colX[g.colX.length - 1];
      if (pt.x >= g.leftPt - HOVER_PAD && pt.x <= right + HOVER_PAD &&
          pt.y >= g.yTop - HOVER_PAD && pt.y <= g.yBottom + HOVER_PAD) {
        showHandles(page, table, g, svg);
        return;
      }
    }
    hideHandles();
  });

  window.addEventListener("mouseup", (e) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    document.querySelectorAll(".tblghost").forEach((n) => n.remove());
    if (d.kind === "resize") {
      const g = d.s.g;
      const dx = ptOf(d.s.svg, e.clientX, e.clientY).x - d.startX;
      if (Math.abs(dx) < 0.5) return;
      const oldTotal = g.colX[g.colX.length - 1] - g.leftPt;
      const newTotal = Math.max(40, oldTotal + dx);
      edit(() => S.conv.set_table_total_width(`d/${d.s.table}`, newTotal));
      return;
    }
    const from = d.s.table;
    if (d.to === null) return;
    const to = d.to > from ? d.to - 1 : d.to;
    if (to === from) return;
    edit(() => {
      const json = S.conv.move_body_item(from, to);
      S.caret = { path: `d/${to}.0.0.0`, off: 0 };
      S.sel = null;
      return json;
    });
    report(`표를 ${from} → ${to} 위치로 이동`);
  }, { capture: true });
}

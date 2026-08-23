// Drag-to-resize table columns: hovering a column boundary shows a
// col-resize cursor; dragging moves a ghost line and commits the new
// grid width on release (one history entry). Boundary positions come
// from the table's grid widths plus its rendered left edge, so they
// match the drawn borders exactly.

import { S } from "./state.js";
import { pagesEl } from "./render.js";
import { edit } from "./edit.js";
import { tableGeom, tablesOnPage } from "./tablegeo.js";

const GRAB_PT = 3;       // half-width of the grab zone around a boundary
const MIN_COL_PT = 20;

interface Boundary {
  table: number;        // body content index
  col: number;          // grid column left of the boundary
  xPt: number;          // boundary x in viewBox pt
  yTop: number;
  yBottom: number;
  page: number;
  svg: SVGSVGElement;
}

function boundaryAt(clientX: number, clientY: number): Boundary | null {
  const el = document.elementFromPoint(clientX, clientY);
  const svg = el && (el.closest("svg") as SVGSVGElement | null);
  if (!svg || !pagesEl.contains(svg)) return null;
  const page = [...pagesEl.children].indexOf(svg) + 1;
  const pt = new DOMPoint(clientX, clientY).matrixTransform(svg.getScreenCTM()!.inverse());
  for (const table of tablesOnPage(page)) {
    const g = tableGeom(page, table);
    if (!g || pt.y < g.yTop || pt.y > g.yBottom) continue;
    for (let c = 0; c < g.grid.length; c++) {
      const x = g.colX[c + 1];
      if (Math.abs(pt.x - x) <= GRAB_PT) {
        return { table, col: c, xPt: x, yTop: g.yTop, yBottom: g.yBottom, page, svg };
      }
    }
  }
  return null;
}

let drag: { b: Boundary; startXPt: number; ghost: SVGLineElement } | null = null;

function ptOf(svg: SVGSVGElement, clientX: number, clientY: number) {
  return new DOMPoint(clientX, clientY).matrixTransform(svg.getScreenCTM()!.inverse());
}

export const isResizingColumn = () => drag !== null;

export function wireColResize() {
  // Capture phase: a boundary grab must win over the caret mousedown.
  pagesEl.addEventListener("mousedown", (e) => {
    const b = boundaryAt(e.clientX, e.clientY);
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    const ghost = document.createElementNS("http://www.w3.org/2000/svg", "line");
    ghost.setAttribute("x1", String(b.xPt));
    ghost.setAttribute("x2", String(b.xPt));
    ghost.setAttribute("y1", String(b.yTop));
    ghost.setAttribute("y2", String(b.yBottom));
    ghost.setAttribute("stroke", "#1a73e8");
    ghost.setAttribute("stroke-width", "0.8");
    ghost.setAttribute("stroke-dasharray", "3 2");
    ghost.setAttribute("class", "colghost");
    b.svg.appendChild(ghost);
    drag = { b, startXPt: b.xPt, ghost };
  }, { capture: true });

  window.addEventListener("mousemove", (e) => {
    if (drag) {
      const pt = ptOf(drag.b.svg, e.clientX, e.clientY);
      const minX = drag.startXPt - Number.MAX_SAFE_INTEGER; // clamped on commit
      const x = Math.max(minX, pt.x);
      drag.ghost.setAttribute("x1", String(x));
      drag.ghost.setAttribute("x2", String(x));
      return;
    }
    // Hover cursor.
    const b = boundaryAt(e.clientX, e.clientY);
    for (const svg of pagesEl.children as HTMLCollectionOf<SVGSVGElement>) {
      svg.style.cursor = b && svg === b.svg ? "col-resize" : "";
    }
  });

  window.addEventListener("mouseup", (e) => {
    if (!drag) return;
    const { b, startXPt, ghost } = drag;
    drag = null;
    ghost.remove();
    const endX = ptOf(b.svg, e.clientX, e.clientY).x;
    const dx = endX - startXPt;
    if (Math.abs(dx) < 0.5) return; // a click, not a resize
    let grid: number[];
    try { grid = JSON.parse(S.conv.table_grid_pt(`d/${b.table}`)); }
    catch (err2) { return; }
    const newW = Math.max(MIN_COL_PT, grid[b.col] + dx);
    edit(() => S.conv.set_table_column_width(`d/${b.table}`, b.col, newW));
  }, { capture: true });
}

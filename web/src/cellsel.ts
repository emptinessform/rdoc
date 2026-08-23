// Cell-block selection: dragging from one table cell into another
// selects whole cells (Word/LibreOffice convention) instead of text.
// The block is a rectangle of (row, col) cells within one table on one
// page; merge and other cell ops consume it.

import { pagesEl, report } from "./render.js";
import { tableGeom } from "./tablegeo.js";

export interface CellSel {
  page: number;
  table: number;
  r0: number; c0: number; // top-left cell
  r1: number; c1: number; // bottom-right cell (inclusive)
}

let cur: CellSel | null = null;

export const cellSel = (): CellSel | null => cur;

export function setCellSel(cs: CellSel) {
  cur = cs;
  draw();
  const rows = cs.r1 - cs.r0 + 1, cols = cs.c1 - cs.c0 + 1;
  report(`셀 블록 ${rows}×${cols} 선택 (병합: 툴바/삽입 메뉴, 해제: Esc)`);
}

/** Clears the block if one is active; returns whether there was one. */
export function clearCellSel(): boolean {
  if (!cur) return false;
  cur = null;
  draw();
  return true;
}

function draw() {
  document.querySelectorAll(".cellselrect").forEach((n) => n.remove());
  if (!cur) return;
  const svg = pagesEl.children[cur.page - 1];
  const g = svg && tableGeom(cur.page, cur.table);
  if (!g) { cur = null; return; }
  for (const r of g.rows) {
    if (r < cur.r0 || r > cur.r1) continue;
    const band = g.rowY.get(r)!;
    for (let c = cur.c0; c <= cur.c1 && c < g.grid.length; c++) {
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("x", String(g.colX[c]));
      rect.setAttribute("y", String(band.top));
      rect.setAttribute("width", String(g.grid[c]));
      rect.setAttribute("height", String(band.bottom - band.top));
      rect.setAttribute("fill", "#1a73e8");
      rect.setAttribute("opacity", "0.22");
      rect.setAttribute("class", "cellselrect");
      svg.appendChild(rect);
    }
  }
}

// Table geometry from rendered hits + grid widths — shared by the
// column-resize UI and cell-block selection. All coordinates are page
// viewBox pt.

import { S } from "./state.js";

export const CELL_PAD_PT = 5.4; // Word's default 108tw left cell margin

export interface TableGeom {
  table: number;
  leftPt: number;
  grid: number[];         // column widths, pt
  colX: number[];         // column boundary xs: colX[0]=left .. colX[n]=right
  rows: number[];         // row indices present on this page (sorted)
  rowY: Map<number, { top: number; bottom: number }>;
  yTop: number;
  yBottom: number;
}

export function tablesOnPage(page: number): number[] {
  const out = new Set<number>();
  for (const h of S.pageHits[page - 1] ?? []) {
    const m = h.path?.match(/^d\/(\d+)\.\d+\.\d+\./);
    if (m) out.add(+m[1]);
  }
  return [...out];
}

export function tableGeom(page: number, table: number): TableGeom | null {
  const re = new RegExp(`^d/${table}\\.(\\d+)\\.(\\d+)\\.`);
  const cells = (S.pageHits[page - 1] ?? []).filter((h) => h.path && re.test(h.path));
  if (!cells.length) return null;
  let grid: number[];
  try { grid = JSON.parse(S.conv.table_grid_pt(`d/${table}`)); }
  catch (e) { return null; }
  if (!grid.length) return null;
  const col0 = cells.filter((h) => +h.path!.match(re)![2] === 0);
  if (!col0.length) return null;
  const leftPt = Math.min(...col0.map((h) => h.x)) - CELL_PAD_PT;
  const colX = [leftPt];
  for (const w of grid) colX.push(colX[colX.length - 1] + w);

  const rowY = new Map<number, { top: number; bottom: number }>();
  for (const h of cells) {
    const r = +h.path!.match(re)![1];
    const top = h.y - 0.95 * h.size;
    const bottom = h.y + 0.35 * h.size;
    const cur = rowY.get(r);
    rowY.set(r, cur
      ? { top: Math.min(cur.top, top), bottom: Math.max(cur.bottom, bottom) }
      : { top, bottom });
  }
  // Stretch each row band to meet its neighbors so cell rects tile.
  const rows = [...rowY.keys()].sort((a, b) => a - b);
  for (let i = 0; i + 1 < rows.length; i++) {
    const a = rowY.get(rows[i])!, b = rowY.get(rows[i + 1])!;
    const mid = (a.bottom + b.top) / 2;
    a.bottom = mid;
    b.top = mid;
  }
  const yTop = rowY.get(rows[0])!.top;
  const yBottom = rowY.get(rows[rows.length - 1])!.bottom;
  return { table, leftPt, grid, colX, rows, rowY, yTop, yBottom };
}

/// The (table, row, col) cell under a viewBox point on a page, or null.
export function cellAt(page: number, xPt: number, yPt: number):
  { table: number; row: number; col: number } | null {
  for (const table of tablesOnPage(page)) {
    const g = tableGeom(page, table);
    if (!g || yPt < g.yTop || yPt > g.yBottom) continue;
    if (xPt < g.colX[0] || xPt > g.colX[g.colX.length - 1]) continue;
    let col = -1;
    for (let c = 0; c < g.grid.length; c++) {
      if (xPt >= g.colX[c] && xPt <= g.colX[c + 1]) { col = c; break; }
    }
    if (col < 0) continue;
    for (const r of g.rows) {
      const band = g.rowY.get(r)!;
      if (yPt >= band.top && yPt <= band.bottom) return { table, row: r, col };
    }
  }
  return null;
}

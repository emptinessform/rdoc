window.__benchResult = "pending";
(async () => {
  for (let i = 0; i < 120 && !window.__t; i++) await new Promise(r => setTimeout(r, 500));
  const t = window.__t;
  if (!t) { window.__benchResult = JSON.stringify({ error: "__t never appeared" }); return; }
  document.getElementById("demo").click();
  await new Promise(r => setTimeout(r, 1500));
  const res = { ok: true, fails: [], info: {} };
  const check = (name, cond) => { if (!cond) { res.ok = false; res.fails.push(name); } };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const overlayCount = () => document.querySelectorAll(".cellselrect").length;

  // Demo table d/10 has 3 columns.
  const svg = document.querySelector("#pages svg");
  const r = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  const toClient = (h) => ({
    x: r.left + (h.x / vb.width) * r.width,
    y: r.top + ((h.y - 0.4 * h.size) / vb.height) * r.height,
  });
  const hitIn = (row, col) => t.hits(1).find(h => h.path && h.path.startsWith(`d/10.${row}.${col}.`));
  const h00 = hitIn(0, 0), h01 = hitIn(0, 1);
  check("cells (0,0) and (0,1) have hits", !!h00 && !!h01);

  // 1. Drag from cell (0,0) into cell (0,1) -> cell-block selection.
  const p0 = toClient(h00), p1 = toClient(h01);
  svg.dispatchEvent(new MouseEvent("mousedown", { clientX: p0.x, clientY: p0.y, bubbles: true }));
  svg.dispatchEvent(new MouseEvent("mousemove", { clientX: p1.x, clientY: p1.y, bubbles: true }));
  window.dispatchEvent(new MouseEvent("mouseup", { clientX: p1.x, clientY: p1.y, bubbles: true }));
  await wait(200);
  const cs = t.cellSel();
  res.info.cellSel = cs;
  check("drag selects a 1x2 cell block",
    !!cs && cs.table === 10 && cs.r0 === 0 && cs.r1 === 0 && cs.c0 === 0 && cs.c1 === 1);
  check("block overlay covers two cells", overlayCount() === 2);
  check("text selection is off in block mode", t.selText() === "");

  // 2. Merge consumes the block: 3 cells in row 0 become 2.
  document.getElementById("mergebtn").click();
  await wait(400);
  check("block cleared after merge", t.cellSel() === null);
  check("row 0 lost a cell", t.textAt("d/10.0.2.0") == null);
  check("merged cell exists", t.textAt("d/10.0.1.0") != null);
  check("caret lands in the merged cell", t.state().caret && t.state().caret.path === "d/10.0.0.0");
  t.undo();
  await wait(400);
  check("undo restores the third cell", t.textAt("d/10.0.2.0") != null);

  // 3. Esc clears an active block.
  t.selectCells(1, 10, 0, 0, 0, 2);
  check("selectCells shows three overlays", overlayCount() === 3);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await wait(100);
  check("Esc clears the block", t.cellSel() === null && overlayCount() === 0);

  // 4. A multi-row block refuses to merge (vertical merge unsupported).
  if (t.textAt("d/10.1.0.0") != null) {
    t.selectCells(1, 10, 0, 0, 1, 1);
    document.getElementById("mergebtn").click();
    await wait(300);
    check("multi-row merge refused: structure intact", t.textAt("d/10.0.2.0") != null);
    t.clearCellSel();
  } else {
    res.info.multiRow = "table has one row; skipped";
  }

  // 5. A plain click clears any block.
  t.selectCells(1, 10, 0, 0, 0, 1);
  const any = t.hits(1).find(h => h.path === "d/0" || (h.path && /^d\/\d+$/.test(h.path)));
  t.clickAt(1, any.x + 1, any.y - 2);
  check("clickAt clears the block", t.cellSel() === null && overlayCount() === 0);

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

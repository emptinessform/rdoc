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
  const T = "d/10"; // the demo table (3 columns)
  const sum = (a) => a.reduce((x, y) => x + y, 0);

  // 1. Proportional total-width API: +25% keeps the column ratios.
  const grid0 = t.tableGrid(T);
  const total0 = sum(grid0);
  t.setTableWidth(T, total0 * 1.25);
  await wait(400);
  const grid1 = t.tableGrid(T);
  res.info.grids = { grid0, grid1 };
  check("total grew ~25%", Math.abs(sum(grid1) - total0 * 1.25) < 3);
  check("ratios preserved",
    Math.abs(grid1[0] / grid1[1] - grid0[0] / grid0[1]) < 0.02);
  t.undo();
  await wait(400);
  check("undo restores total", Math.abs(sum(t.tableGrid(T)) - total0) < 1);

  // 2. Move API: table body index 10 -> 8, paragraphs shift down.
  const para8 = t.textAt("d/8");
  t.moveTable(10, 8);
  await wait(400);
  check("table now at d/8", t.textAt("d/8.0.0.0") != null);
  check("old table slot is gone", t.textAt("d/10.0.0.0") == null);
  check("paragraph shifted to d/9", t.textAt("d/9") === para8);
  t.undo();
  await wait(400);
  check("undo restores position", t.textAt("d/10.0.0.0") != null && t.textAt("d/8") === para8);

  // 3. Hovering the table shows move + resize handles.
  const svg = document.querySelector("#pages svg");
  const r = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  const toClientX = (x) => r.left + (x / vb.width) * r.width;
  const toClientY = (y) => r.top + (y / vb.height) * r.height;
  const cellHit = t.hits(1).find(h => h.path && h.path.startsWith("d/10."));
  window.dispatchEvent(new MouseEvent("mousemove", {
    clientX: toClientX(cellHit.x + 5), clientY: toClientY(cellHit.y - 2), bubbles: true,
  }));
  await wait(100);
  const moveH = document.querySelector(".tblhandle-move");
  const sizeH = document.querySelector(".tblhandle-size");
  check("handles appear on hover", !!moveH && !!sizeH);

  // 4. Resize-handle drag: +36pt commits a proportional width change.
  if (sizeH) {
    const hx = +sizeH.getAttribute("x") + 4, hy = +sizeH.getAttribute("y") + 4;
    const cx = toClientX(hx), cy = toClientY(hy);
    const dxPx = (36 / vb.width) * r.width;
    svg.dispatchEvent(new MouseEvent("mousedown", { clientX: cx, clientY: cy, bubbles: true }));
    check("resize grab does not move the caret", t.state().caret === null);
    check("resize ghost appears", document.querySelectorAll(".tblghost").length === 1);
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: cx + dxPx, clientY: cy, bubbles: true }));
    window.dispatchEvent(new MouseEvent("mouseup", { clientX: cx + dxPx, clientY: cy, bubbles: true }));
    await wait(400);
    const grid2 = t.tableGrid(T);
    res.info.grid2 = grid2;
    check("drag commits ~+36pt total", Math.abs(sum(grid2) - total0 - 36) < 3);
    check("ghost removed", document.querySelectorAll(".tblghost").length === 0);
    t.undo();
    await wait(400);
  }

  // 5. Move-handle drag: drop the table above paragraph d/8.
  window.dispatchEvent(new MouseEvent("mousemove", {
    clientX: toClientX(cellHit.x + 5), clientY: toClientY(cellHit.y - 2), bubbles: true,
  }));
  await wait(100);
  const moveH2 = document.querySelector(".tblhandle-move");
  check("move handle back after undo", !!moveH2);
  if (moveH2) {
    const hx = +moveH2.getAttribute("x") + 4, hy = +moveH2.getAttribute("y") + 4;
    const p8 = t.hits(1).find(h => h.path === "d/8");
    svg.dispatchEvent(new MouseEvent("mousedown", {
      clientX: toClientX(hx), clientY: toClientY(hy), bubbles: true,
    }));
    check("move ghost line appears", document.querySelectorAll(".tblghost").length === 1);
    window.dispatchEvent(new MouseEvent("mousemove", {
      clientX: toClientX(p8.x + 3), clientY: toClientY(p8.y - 0.9 * p8.size), bubbles: true,
    }));
    window.dispatchEvent(new MouseEvent("mouseup", {
      clientX: toClientX(p8.x + 3), clientY: toClientY(p8.y - 0.9 * p8.size), bubbles: true,
    }));
    await wait(500);
    check("drag moved table to d/8", t.textAt("d/8.0.0.0") != null);
    check("drag: old slot gone", t.textAt("d/10.0.0.0") == null);
    t.undo();
    await wait(400);
    check("undo restores drag move", t.textAt("d/10.0.0.0") != null);
  }

  // 6. Round-trip keeps a committed width.
  t.setTableWidth(T, total0 + 30);
  await wait(300);
  const bytes = t.saveDocx();
  await t.loadBytes(bytes);
  await wait(600);
  check("round-trip keeps total width", Math.abs(sum(t.tableGrid(T)) - total0 - 30) < 3);

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

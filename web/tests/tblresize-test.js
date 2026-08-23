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
  const T = "d/10"; // the demo table

  const col1Left = () => Math.min(...t.hits(1)
    .filter(h => h.path && new RegExp("^d/10\\.\\d+\\.1\\.").test(h.path))
    .map(h => h.x));

  // 1. Grid is readable and the API resize moves the next column.
  const grid0 = t.tableGrid(T);
  res.info.grid0 = grid0;
  check("grid has three columns", grid0.length === 3 && grid0.every(w => w > 0));
  const x1a = col1Left();
  t.setColWidth(T, 0, grid0[0] + 40);
  await wait(400);
  const grid1 = t.tableGrid(T);
  const x1b = col1Left();
  res.info.after = { grid1, x1a, x1b };
  check("grid width grew by 40", Math.abs(grid1[0] - grid0[0] - 40) < 0.5);
  // Layout normalizes the grid into the table width, so the rendered
  // shift is directional, not 1:1 with the grid delta.
  check("next column shifted right", x1b - x1a > 10);
  t.undo();
  await wait(400);
  check("undo restores width", Math.abs(t.tableGrid(T)[0] - grid0[0]) < 0.5);

  // 2. Drag on the first boundary: mousedown at the boundary must NOT
  // place a caret; dragging +30pt commits the width.
  const svg = document.querySelector("#pages svg");
  const r = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  const cellHit = t.hits(1).find(h => h.path && h.path.startsWith("d/10.") );
  const leftPt = Math.min(...t.hits(1)
    .filter(h => h.path && new RegExp("^d/10\\.\\d+\\.0\\.").test(h.path)).map(h => h.x)) - 5.4;
  const bx = leftPt + t.tableGrid(T)[0];
  const by = cellHit.y - 2;
  const cx = r.left + (bx / vb.width) * r.width;
  const cy = r.top + (by / vb.height) * r.height;
  const dxPx = (30 / vb.width) * r.width;
  svg.dispatchEvent(new MouseEvent("mousedown", { clientX: cx, clientY: cy, bubbles: true }));
  check("boundary grab does not move the caret", t.state().caret === null);
  check("ghost line appears", document.querySelectorAll(".colghost").length === 1);
  document.dispatchEvent(new MouseEvent("mousemove", { clientX: cx + dxPx, clientY: cy, bubbles: true }));
  window.dispatchEvent(new MouseEvent("mouseup", { clientX: cx + dxPx, clientY: cy, bubbles: true }));
  await wait(400);
  const grid2 = t.tableGrid(T);
  res.info.grid2 = grid2;
  check("drag commits ~+30pt", Math.abs(grid2[0] - grid0[0] - 30) < 2);
  check("ghost removed", document.querySelectorAll(".colghost").length === 0);

  // 3. Round-trip keeps the width; undo returns.
  const bytes = t.saveDocx();
  await t.loadBytes(bytes);
  await wait(600);
  check("round-trip keeps width", Math.abs(t.tableGrid(T)[0] - grid0[0] - 30) < 2);

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

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

  // 1. Insert a 2x3 table after d/3; the caret lands in its first cell.
  const d4Before = t.textAt("d/4");
  const h = t.hits(1).find(x => x.path === "d/3" && x.start === 0);
  t.clickAt(1, h.x + 1, h.y - 2);
  t.insertTable(2, 3);
  await wait(500);
  check("first cell exists and is empty", t.textAt("d/4.0.0.0") === "");
  check("last cell exists", t.textAt("d/4.1.2.0") === "");
  check("no extra column", t.textAt("d/4.0.3.0") == null);
  check("following content shifted", t.textAt("d/5") === d4Before);
  check("caret in first cell", t.state().caret && t.state().caret.path === "d/4.0.0.0");

  // 2. The table renders with borders on page 1.
  const cellHit = t.hits(1).find(x => x.path === "d/4.0.0.0");
  check("cell hit rendered", !!cellHit);

  // 3. Type into a cell, then round-trip.
  t.type("셀입력");
  await wait(300);
  check("cell accepts typing", t.textAt("d/4.0.0.0") === "셀입력");
  const bytes = t.saveDocx();
  await t.loadBytes(bytes);
  await wait(600);
  check("round-trip keeps table", t.textAt("d/4.0.0.0") === "셀입력" && t.textAt("d/4.1.2.0") === "");

  // 4. Structure ops work on the new table (row add via Tab at last cell
  // is covered elsewhere; here: column add).
  const h2 = t.hits(1).find(x => x.path === "d/4.0.0.0");
  t.clickAt(1, h2.x + 1, h2.y - 2);
  t.tableOp("c");
  await wait(400);
  check("column added to new table", t.textAt("d/4.0.3.0") != null);
  t.undo();

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

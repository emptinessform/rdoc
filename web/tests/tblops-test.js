window.__benchResult = "pending";
(async () => {
  for (let i = 0; i < 120 && !window.__t; i++) await new Promise(r => setTimeout(r, 500));
  const t = window.__t;
  if (!t) { window.__benchResult = JSON.stringify({ error: "__t never appeared" }); return; }
  document.getElementById("demo").click();
  await new Promise(r => setTimeout(r, 1500));
  const res = { ok: true, fails: [], info: {} };
  const check = (name, cond) => { if (!cond) { res.ok = false; res.fails.push(name); } };
  const hit = (pp) => { for (let pi = 1; pi <= 2; pi++) for (const h of t.hits(pi)) if (h.path === pp && h.start !== null) return { h, page: pi }; return null; };

  // Demo table d/10: header row 0, data rows 1..3, 3 columns.
  const clickCell = (pp) => { const c = hit(pp); t.clickAt(c.page, c.h.x + 2, c.h.y - 2); };

  // 1. Insert a row below row 1 ("Text" row): new empty row at index 2.
  clickCell("d/10.1.0.0");
  t.tableOp("r");
  check("new row empty", t.textAt("d/10.2.0.0") === "" && t.textAt("d/10.2.2.0") === "");
  check("old row 2 shifted", t.textAt("d/10.3.0.0") === "Border");
  check("caret kept", t.state().caret && t.state().caret.path === "d/10.1.0.0");
  t.undo();
  check("undo removes row", t.textAt("d/10.2.0.0") === "Border");

  // 2. Delete row 1: "Text" row gone.
  clickCell("d/10.1.0.0");
  t.tableOp("R");
  check("row deleted", t.textAt("d/10.1.0.0") === "Border");
  t.undo();
  check("undo restores row", t.textAt("d/10.1.0.0") === "Text");

  // 3. Insert a column right of col 0: every row gains an empty cell at 1.
  clickCell("d/10.1.0.0");
  t.tableOp("c");
  check("new col empty (header+data)", t.textAt("d/10.0.1.0") === "" && t.textAt("d/10.1.1.0") === "");
  check("old col 1 shifted", t.textAt("d/10.0.2.0") === "Layout type" && t.textAt("d/10.1.2.0") === "GlyphRun");
  t.undo();
  check("undo removes col", t.textAt("d/10.0.1.0") === "Layout type");

  // 4. Delete column 0: "Element"/"Text" column gone.
  clickCell("d/10.1.0.0");
  t.tableOp("C");
  check("col deleted", t.textAt("d/10.0.0.0") === "Layout type" && t.textAt("d/10.1.0.0") === "GlyphRun");
  t.undo();
  check("undo restores col", t.textAt("d/10.0.0.0") === "Element");

  // 5. Row insert survives a save round-trip.
  clickCell("d/10.1.0.0");
  t.tableOp("r");
  t.clickAt(hit("d/10.2.0.0") ? hit("d/10.2.0.0").page : 1, hit("d/10.2.0.0").h.x + 2, hit("d/10.2.0.0").h.y - 2);
  // Type into the new row so the round trip is observable text, not just structure.
  t.type("새 셀");
  const bytes = t.saveDocx();
  await t.loadBytes(bytes);
  await new Promise(r => setTimeout(r, 800));
  check("round-trip keeps new row", t.textAt("d/10.2.0.0") === "새 셀" && t.textAt("d/10.3.0.0") === "Border");

  // 6. Refusal outside a table.
  const p4 = t.textAt("d/4");
  t.clickAt(1, 150, 200);
  t.tableOp("r"); // reports an error, must not change anything
  check("refused outside table", t.textAt("d/4") === p4);

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

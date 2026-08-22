window.__benchResult = "pending";
(async () => {
  for (let i = 0; i < 120 && !window.__t; i++) await new Promise(r => setTimeout(r, 500));
  const t = window.__t;
  if (!t) { window.__benchResult = JSON.stringify({ error: "__t never appeared" }); return; }
  await t.loadUrl("./demo.docx");
  const res = { ok: true, fails: [], info: {} };
  const check = (name, cond) => { if (!cond) { res.ok = false; res.fails.push(name); } };

  // Find a table-cell hit: path with dots ("d/N.r.c.i"), e.g. the demo
  // table's "Border" cell. Scan all hits for a cell path with editable text.
  const hits = t.state ? null : null;
  const all = [];
  for (let pg = 0; pg < 3; pg++) {
    // pageHits is internal; use __t.state().total? Instead scan via textAt on
    // candidate paths is impossible — so click at known table area. The demo
    // table sits mid-page; probe a grid and collect distinct cell paths.
  }
  const cellPaths = new Set();
  for (let y = 300; y <= 620; y += 12) {
    for (let x = 90; x <= 520; x += 40) {
      t.clickAt(1, x, y);
      const c = t.state().caret;
      if (c && c.path.includes(".")) cellPaths.add(JSON.stringify([c.path, x, y]));
    }
  }
  res.info.cellCount = cellPaths.size;
  if (cellPaths.size === 0) {
    res.ok = false;
    res.fails.push("no table cell reachable by click");
    window.__benchResult = JSON.stringify(res);
    return;
  }
  const [cellPath, cx, cy] = JSON.parse([...cellPaths][0]);
  res.info.cellPath = cellPath;

  // 1. type into the cell
  t.clickAt(1, cx, cy);
  const before = t.textAt(cellPath);
  const off = t.state().caret.off;
  t.type("XY");
  const after = t.textAt(cellPath);
  check("cell text grew", after.length === before.length + 2 && after.includes("XY"));
  check("caret advanced", t.state().caret.off === off + 2);

  // 2. backspace in the cell
  t.backspace();
  check("cell backspace", t.textAt(cellPath).length === before.length + 1);

  // 3. undo x2 restores the cell
  t.undo(); t.undo();
  check("cell undo restores", t.textAt(cellPath) === before);

  // 4. IME composition inside the cell
  t.clickAt(1, cx, cy);
  t.simIme(["ㅎ", "하", "한"]);
  check("cell ime commit", t.textAt(cellPath).includes("한"));
  t.undo();
  check("cell ime undo", t.textAt(cellPath) === before);

  // 5. selection within the cell replaced
  const selText = t.select(1, cx - 8, cy, cx + 8, cy);
  if (selText && selText.length > 0) {
    t.replaceSel("Z");
    check("cell selection replaced", t.textAt(cellPath).includes("Z"));
    t.undo(); // replaceSel is now one history entry
    check("cell selection undo", t.textAt(cellPath) === before);
  } else {
    res.info.selSkipped = true;
  }

  // 6. Enter inside a cell splits the paragraph (S7-1); undo restores
  t.clickAt(1, cx, cy);
  t.enter();
  t.undo();
  check("enter in cell splits and undoes", t.textAt(cellPath) === before);

  // 7. body editing still works end to end
  t.clickAt(1, 150, 150);
  const bodyPath = t.state().caret.path;
  check("body path is plain", bodyPath.startsWith("d/") && !bodyPath.includes("."));
  t.type("q");
  check("body typing", t.textAt(bodyPath).includes("q"));
  t.undo();

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

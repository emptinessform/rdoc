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
  // The renderer emits colors as rgb(r,g,b).
  const rgb = (hex) => `rgb(${parseInt(hex.slice(0, 2), 16)},${parseInt(hex.slice(2, 4), 16)},${parseInt(hex.slice(4, 6), 16)})`;
  const countFill = (hex) => [...document.querySelectorAll("#pages svg rect")]
    .filter(r => (r.getAttribute("fill") || "").replace(/\s/g, "") === rgb(hex)).length;
  const countStroke = (hex) => [...document.querySelectorAll("#pages svg line, #pages svg path")]
    .filter(l => (l.getAttribute("stroke") || "").replace(/\s/g, "") === rgb(hex)).length;

  // 1. Cell shading through the real UI path: cell block + color picker.
  t.selectCells(1, 10, 1, 0, 1, 1);
  const shadeEl = document.getElementById("cellshade");
  shadeEl.value = "#ffcc00";
  shadeEl.dispatchEvent(new Event("change"));
  await wait(400);
  res.info.shaded = countFill("FFCC00");
  check("two cells get the shading fill", countFill("FFCC00") >= 2);
  check("cell block consumed", t.cellSel() === null);
  t.undo();
  await wait(400);
  check("undo removes the shading", countFill("FFCC00") === 0);

  // 2. Caret-cell shading (no block).
  const cellHit = t.hits(1).find(h => h.path && h.path.startsWith("d/10.0.0."));
  t.clickAt(1, cellHit.x + 1, cellHit.y - 2);
  shadeEl.value = "#ccffcc";
  shadeEl.dispatchEvent(new Event("change"));
  await wait(400);
  check("caret cell gets shading", countFill("CCFFCC") >= 1);
  t.undo();
  await wait(400);

  // 3. Table borders: dashed red 1.5pt over the whole table.
  const red0 = countStroke("FF0000");
  t.tableBorders("d/10", "dashed", 1.5, "FF0000");
  await wait(400);
  res.info.red = countStroke("FF0000");
  check("red border lines appear", countStroke("FF0000") > red0 + 4);
  t.undo();
  await wait(400);
  check("undo removes red borders", countStroke("FF0000") === red0);

  // 4. Style "none" removes the drawn borders.
  t.tableBorders("d/10", "none", 0.5, "000000");
  await wait(400);
  t.tableBorders("d/10", "single", 0.5, "FF0000");
  await wait(400);
  const withB = countStroke("FF0000");
  t.undo(); // back to none
  await wait(400);
  res.info.none = { withB, after: countStroke("FF0000") };
  check("none style draws no border lines", countStroke("FF0000") === 0 && withB > 4);
  t.undo(); // back to original
  await wait(400);

  // 5. Round-trip: shading + borders survive save/load.
  t.cellShading(["d/10.1.0.0", "d/10.1.1.0"], "FFCC00");
  await wait(300);
  t.tableBorders("d/10", "double", 1, "3366BB");
  await wait(300);
  const bytes = t.saveDocx();
  await t.loadBytes(bytes);
  await wait(600);
  check("round-trip keeps shading", countFill("FFCC00") >= 2);
  check("round-trip keeps border color", countStroke("3366BB") > 4);

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

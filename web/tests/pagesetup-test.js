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
  const vb = () => {
    const b = document.querySelector("#pages svg").viewBox.baseVal;
    return { w: b.width, h: b.height };
  };

  const info0 = t.pageInfo();
  res.info.info0 = info0;
  check("demo starts portrait", info0.landscape === false && info0.h > info0.w);
  const vb0 = vb();

  // 1. Landscape flips the page box (width/height swap) and reflows.
  t.setOrientation(true);
  await wait(500);
  const i1 = t.pageInfo();
  const v1 = vb();
  res.info.afterLandscape = { i1, v1 };
  check("landscape swaps dims", i1.landscape === true && Math.abs(i1.w - info0.h) < 0.5);
  check("rendered page box swaps", Math.abs(v1.w - vb0.h) < 0.5 && v1.w > v1.h);
  t.undo();
  await wait(500);
  check("undo restores portrait", t.pageInfo().landscape === false && Math.abs(vb().w - vb0.w) < 0.5);

  // 2. Paper: Letter changes the box to 612x792 (portrait kept).
  t.setPaper(612, 792);
  await wait(500);
  const v2 = vb();
  check("letter page box", Math.abs(v2.w - 612) < 0.5 && Math.abs(v2.h - 792) < 0.5);
  check("letter keeps portrait", t.pageInfo().landscape === false);
  t.undo();
  await wait(500);

  // 3. Narrow margins move the first body line left and up.
  const firstBody = () => t.hits(1).filter(h => h.path && h.path.startsWith("d/") && h.start !== null)
    .sort((a, b) => a.y - b.y || a.x - b.x)[0];
  const b0 = firstBody();
  t.setMargins(36, 36, 36, 36);
  await wait(500);
  const b1 = firstBody();
  res.info.margins = { before: { x: b0.x, y: b0.y }, after: { x: b1.x, y: b1.y } };
  check("narrow margins move text left", b1.x < b0.x - 10);
  check("margins reported", Math.abs(t.pageInfo().ml - 36) < 0.5);

  // 4. Margins survive a save round-trip.
  const bytes = t.saveDocx();
  await t.loadBytes(bytes);
  await wait(800);
  check("round-trip keeps margins", Math.abs(t.pageInfo().ml - 36) < 0.5);

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

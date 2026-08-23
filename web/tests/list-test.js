window.__benchResult = "pending";
(async () => {
  for (let i = 0; i < 120 && !window.__t; i++) await new Promise(r => setTimeout(r, 500));
  const t = window.__t;
  if (!t) { window.__benchResult = JSON.stringify({ error: "__t never appeared" }); return; }
  document.getElementById("demo").click();
  await new Promise(r => setTimeout(r, 1500));
  const res = { ok: true, fails: [], info: {} };
  const check = (name, cond) => { if (!cond) { res.ok = false; res.fails.push(name); } };
  const press = (key, init) => document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const info = (p) => { const j = t.listInfo(p); return j === "null" ? null : JSON.parse(j); };
  const firstHit = (p) => t.hits(1).filter(h => h.path === p && h.start !== null)
    .sort((a, b) => a.start - b.start)[0];
  // Decorative marker hit on the same baseline, left of the paragraph text.
  const markerOf = (p) => {
    const f = firstHit(p);
    return f && t.hits(1).find(h => h.path === null && Math.abs(h.y - f.y) < 2 && h.x < f.x);
  };

  // 1. Toggle a plain paragraph (d/3, 한글 조판 테스트) into a bullet list.
  const p3 = "d/3";
  check("d/3 starts plain", info(p3) === null);
  const f0 = firstHit(p3);
  t.clickAt(1, f0.x + 1, f0.y - 2);
  t.toggleList("bullet");
  await wait(300);
  const li1 = info(p3);
  res.info.afterBullet = li1;
  check("bullet on", li1 && li1.bullet === true && li1.level === 0);
  const mk1 = markerOf(p3);
  res.info.marker = mk1 && mk1.text;
  check("bullet marker rendered", !!mk1);
  check("caret survived", t.state().caret && t.state().caret.path === p3);

  // 2. Toggle again: removed (all-on -> off).
  t.toggleList("bullet");
  await wait(300);
  check("bullet toggled off", info(p3) === null);
  t.undo(); // back to bulleted for the next steps
  await wait(300);
  check("undo restores bullet", info(p3) !== null);

  // 3. Tab / Shift+Tab changes the level; the marker indents.
  // (undo cleared the caret — put it back first)
  const f1 = firstHit(p3);
  t.clickAt(1, f1.x + 1, f1.y - 2);
  const x1 = markerOf(p3).x;
  press("Tab");
  await wait(300);
  const li2 = info(p3);
  check("Tab raises level", li2 && li2.level === 1);
  check("marker indented", markerOf(p3).x > x1 + 1);
  press("Tab", { shiftKey: true });
  await wait(300);
  check("Shift+Tab lowers level", info(p3).level === 0);

  // 4. Enter at the end of a list paragraph continues the list.
  const len3 = [...t.textAt(p3)].length;
  const segs = t.hits(1).filter(h => h.path === p3 && h.start !== null);
  const last = segs[segs.length - 1];
  t.clickAt(1, last.x + last.adv.reduce((a, b) => a + b, 0) - 0.5, last.y - 2);
  press("End");
  press("Enter");
  await wait(400);
  const p4 = "d/4";
  const li4 = info(p4);
  res.info.continued = li4;
  check("Enter continues the list", li4 && li4.bullet === true);
  t.undo();
  await wait(300);

  // 5. Numbered list over two sibling paragraphs; markers are 1. / 2.
  const a = firstHit("d/5"), b = firstHit("d/6");
  t.select(1, a.x + 0.1, a.y - 2, b.x + b.adv[0] + 0.1, b.y - 2);
  t.toggleList("number");
  await wait(400);
  const n5 = info("d/5"), n6 = info("d/6");
  check("both numbered", n5 && n6 && n5.bullet === false && n6.bullet === false);
  const m5 = markerOf("d/5"), m6 = markerOf("d/6");
  res.info.numMarkers = [m5 && m5.text, m6 && m6.text];
  check("markers count 1 and 2", m5 && m6 && /1/.test(m5.text) && /2/.test(m6.text));

  // 6. List membership survives a save round-trip.
  const bytes = t.saveDocx();
  await t.loadBytes(bytes);
  await wait(800);
  check("round-trip keeps bullet", info(p3) && info(p3).bullet === true);
  check("round-trip keeps numbers", info("d/5") && info("d/5").bullet === false);

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

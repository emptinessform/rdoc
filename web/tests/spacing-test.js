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

  // d/3 (한글 조판 테스트 …) wraps onto two lines in the demo: the gap
  // between its two baselines is the line pitch.
  const p = "d/3";
  const pitch = () => {
    const ys = [...new Set(t.hits(1).filter(h => h.path === p && h.start !== null)
      .map(h => Math.round(h.y * 10) / 10))].sort((a, b) => a - b);
    return ys.length >= 2 ? ys[1] - ys[0] : null;
  };
  const g0 = pitch();
  res.info.g0 = g0;
  check("d/3 wraps to 2+ lines", g0 !== null);

  // 1. Double spacing via the caret path; caret survives.
  const f = t.hits(1).filter(h => h.path === p && h.start !== null)[0];
  t.clickAt(1, f.x + 1, f.y - 2);
  t.lineSpacing(2);
  await wait(400);
  const g2 = pitch();
  res.info.g2 = g2;
  check("double spacing doubles the pitch", g2 !== null && g2 / g0 > 1.8 && g2 / g0 < 2.2);
  check("caret survived", t.state().caret && t.state().caret.path === p);

  // 2. One undo restores.
  t.undo();
  await wait(400);
  const g1 = pitch();
  check("undo restores pitch", g1 !== null && Math.abs(g1 - g0) < 0.5);

  // 3. Spacing over a sibling selection (d/3..d/4) is one history entry.
  const a = t.hits(1).filter(h => h.path === p && h.start !== null)[0];
  const b = t.hits(1).filter(h => h.path === "d/4" && h.start !== null)[0];
  t.select(1, a.x + 0.1, a.y - 2, b.x + b.adv[0] + 0.1, b.y - 2);
  t.lineSpacing(1.5);
  await wait(400);
  const g15 = pitch();
  res.info.g15 = g15;
  check("1.5 spacing applied", g15 !== null && g15 / g0 > 1.35 && g15 / g0 < 1.65);
  t.undo();
  await wait(400);
  check("selection apply is one undo", Math.abs(pitch() - g0) < 0.5);

  // 4. Spacing survives a save round-trip.
  t.clickAt(1, f.x + 1, f.y - 2);
  t.lineSpacing(2);
  const bytes = t.saveDocx();
  await t.loadBytes(bytes);
  await wait(800);
  const gr = pitch();
  res.info.gr = gr;
  check("round-trip keeps spacing", gr !== null && gr / g0 > 1.8);

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

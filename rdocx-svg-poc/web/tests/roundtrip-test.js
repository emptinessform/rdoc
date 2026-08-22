window.__benchResult = "pending";
(async () => {
  for (let i = 0; i < 120 && !window.__t; i++) await new Promise(r => setTimeout(r, 500));
  const t = window.__t;
  if (!t) { window.__benchResult = JSON.stringify({ error: "__t never appeared" }); return; }
  document.getElementById("demo").click();
  await new Promise(r => setTimeout(r, 1500));
  const res = { ok: true, fails: [], info: {} };
  const check = (name, cond) => { if (!cond) { res.ok = false; res.fails.push(name); } };

  const probe = (yLo, yHi, want, notWant) => {
    for (let y = yLo; y <= yHi; y += 5) {
      for (let x = 60; x <= 540; x += 24) {
        t.clickAt(1, x, y);
        const c = t.state().caret;
        if (c && c.path.startsWith(want) && (!notWant || !c.path.includes(notWant)))
          return { path: c.path, x, y };
      }
    }
    return null;
  };

  // Locate one editable spot per story.
  const spots = {};
  spots.header = probe(20, 70, "h/");
  spots.body = (() => { t.clickAt(1, 150, 200); const c = t.state().caret;
    return c && c.path.startsWith("d/") && !c.path.includes(".") ? { path: c.path, x: 150, y: 200 } : null; })();
  spots.cell = (() => {
    for (let y = 300; y <= 620; y += 10) for (let x = 90; x <= 520; x += 30) {
      t.clickAt(1, x, y); const c = t.state().caret;
      if (c && c.path.startsWith("d/") && c.path.includes(".")) return { path: c.path, x, y };
    } return null; })();
  spots.footnote = probe(600, 750, "fn/");
  spots.footer = probe(700, 790, "f/");
  res.info.spots = Object.fromEntries(Object.entries(spots).map(([k, v]) => [k, v && v.path]));

  // Type a distinct tag into each story.
  const tags = { header: "H1H", body: "B2B", cell: "C3C", footnote: "N4N", footer: "F5F" };
  const expected = {};
  for (const [k, spot] of Object.entries(spots)) {
    check(k + " reachable", !!spot);
    if (!spot) continue;
    t.clickAt(1, spot.x, spot.y);
    t.type(tags[k]);
    expected[k] = t.textAt(spot.path);
    check(k + " edited", expected[k].includes(tags[k]));
  }

  // Serialize the edited document and reload it from bytes.
  const bytes = t.saveDocx();
  res.info.docxBytes = bytes.length;
  t.loadBytes(bytes);
  await new Promise(r => setTimeout(r, 800));

  // After reload, every tagged text must still be there at the same path.
  for (const [k, spot] of Object.entries(spots)) {
    if (!spot) continue;
    const now = t.textAt(spot.path);
    check(k + " survives round-trip", now === expected[k]);
    if (now !== expected[k]) res.info[k + "_after"] = now;
  }

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

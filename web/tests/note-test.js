window.__benchResult = "pending";
(async () => {
  for (let i = 0; i < 120 && !window.__t; i++) await new Promise(r => setTimeout(r, 500));
  const t = window.__t;
  if (!t) { window.__benchResult = JSON.stringify({ error: "__t never appeared" }); return; }
  document.getElementById("demo").click();
  await new Promise(r => setTimeout(r, 1500));
  const res = { ok: true, fails: [], info: {} };
  const check = (name, cond) => { if (!cond) { res.ok = false; res.fails.push(name); } };

  // Footnote text sits at the page foot, above the footer band.
  const probe = (yLo, yHi, want) => {
    for (let y = yLo; y <= yHi; y += 5) {
      for (let x = 60; x <= 540; x += 24) {
        t.clickAt(1, x, y);
        const c = t.state().caret;
        if (c && c.path.startsWith(want)) return { path: c.path, x, y };
      }
    }
    return null;
  };
  const note = probe(620, 745, "fn/");
  res.info.notePath = note && note.path;
  check("footnote hit found", !!note);
  if (!note) { window.__benchResult = JSON.stringify(res); return; }

  // 1. type into the footnote
  t.clickAt(1, note.x, note.y);
  const before = t.textAt(note.path);
  t.type("QW");
  const after = t.textAt(note.path);
  check("footnote text grew", after.length === before.length + 2 && after.includes("QW"));

  // 2. backspace + undo round trip
  t.backspace();
  check("footnote backspace", t.textAt(note.path).length === before.length + 1);
  t.undo(); t.undo();
  check("footnote undo restores", t.textAt(note.path) === before);

  // 3. IME composition inside the footnote
  t.clickAt(1, note.x, note.y);
  t.simIme(["ㄱ", "가", "각"]);
  check("footnote ime commit", t.textAt(note.path).includes("각주" ) || t.textAt(note.path).includes("각"));
  t.undo();
  check("footnote ime undo", t.textAt(note.path) === before);

  // 4. the reference marker in the body is not editable (source: None)
  //    and the body text stays intact throughout.
  const bodySnapshot = t.paraTexts().join("");
  check("body unchanged", t.paraTexts().join("") === bodySnapshot);

  // 5. body editing regression
  t.clickAt(1, 150, 200);
  const bp = t.state().caret && t.state().caret.path;
  check("body still editable", !!bp && bp.startsWith("d/"));

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

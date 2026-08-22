window.__benchResult = "pending";
(async () => {
  for (let i = 0; i < 120 && !window.__t; i++) await new Promise(r => setTimeout(r, 500));
  const t = window.__t;
  if (!t) { window.__benchResult = JSON.stringify({ error: "__t never appeared" }); return; }
  // load_demo now has header + page-number footer
  document.getElementById("demo").click();
  await new Promise(r => setTimeout(r, 1500));
  const res = { ok: true, fails: [], info: {} };
  const check = (name, cond) => { if (!cond) { res.ok = false; res.fails.push(name); } };

  // Probe the header band (top of page) and footer band (bottom) for paths.
  const probe = (yLo, yHi, want) => {
    for (let y = yLo; y <= yHi; y += 6) {
      for (let x = 60; x <= 540; x += 30) {
        t.clickAt(1, x, y);
        const c = t.state().caret;
        if (c && c.path.startsWith(want)) return { path: c.path, x, y };
      }
    }
    return null;
  };
  const hdr = probe(20, 70, "h/");
  const ftr = probe(720, 780, "f/");
  res.info.hdr = hdr && hdr.path;
  res.info.ftr = ftr && ftr.path;
  check("header hit found", !!hdr);
  check("footer hit found", !!ftr);
  if (!hdr) { window.__benchResult = JSON.stringify(res); return; }

  // 1. type into the header
  t.clickAt(1, hdr.x, hdr.y);
  const before = t.textAt(hdr.path);
  t.type("AB");
  const after = t.textAt(hdr.path);
  check("header text grew", after.length === before.length + 2 && after.includes("AB"));
  res.info.afterType = after;

  // 2. header renders on every page — the edit must redraw all pages
  check("all pages redrawn", t.state().lastDelta.startsWith("2/2") || t.state().lastDelta.startsWith("1/1"));
  res.info.delta = t.state().lastDelta;

  // 3. backspace + undo round trip
  t.backspace();
  check("header backspace", t.textAt(hdr.path).length === before.length + 1);
  t.undo(); t.undo();
  check("header undo restores", t.textAt(hdr.path) === before);

  // 4. IME composition in the header, one undo unit
  t.clickAt(1, hdr.x, hdr.y);
  t.simIme(["ㅁ", "머", "먼"]);
  check("header ime commit", t.textAt(hdr.path).includes("먼"));
  t.undo();
  check("header ime undo", t.textAt(hdr.path) === before);

  // 5. footer literal text editing ("Page " prefix)
  if (ftr) {
    t.clickAt(1, ftr.x, ftr.y);
    const fBefore = t.textAt(ftr.path);
    t.type("Z");
    check("footer text grew", t.textAt(ftr.path).length === fBefore.length + 1);
    t.undo();
    check("footer undo restores", t.textAt(ftr.path) === fBefore);
  }

  // 6. the page-number field glyph itself is not editable (source: None)
  //    — clicking exactly on the number should either land on the literal
  //    run or report decorative; we assert no crash and doc unchanged.
  const snapshot = t.paraTexts().join("");
  t.clickAt(1, 306, 760); // page centre bottom, near the number
  t.type("!");
  const bodyChanged = t.paraTexts().join("") !== snapshot;
  const hfNow = t.textAt(hdr.path);
  res.info.fieldClickPath = t.state().caret && t.state().caret.path;
  check("field click did not corrupt body", !bodyChanged);
  if (bodyChanged) res.fails.push("body changed after field-area click");
  // undo any accidental footer edit from the probe
  while (t.state().caret && t.textAt(hdr.path) !== before) { t.undo(); break; }

  // 7. body editing regression
  t.clickAt(1, 150, 200);
  const bp = t.state().caret && t.state().caret.path;
  check("body still editable", !!bp && bp.startsWith("d/"));

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

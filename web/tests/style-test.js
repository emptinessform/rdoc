window.__benchResult = "pending";
(async () => {
  for (let i = 0; i < 120 && !window.__t; i++) await new Promise(r => setTimeout(r, 500));
  const t = window.__t;
  if (!t) { window.__benchResult = JSON.stringify({ error: "__t never appeared" }); return; }
  document.getElementById("demo").click();
  await new Promise(r => setTimeout(r, 1500));
  const res = { ok: true, fails: [], info: {} };
  const check = (name, cond) => { if (!cond) { res.ok = false; res.fails.push(name); } };
  const sizeOf = (path) => {
    for (let pi = 1; pi <= document.querySelectorAll("#pages svg").length; pi++)
      for (const h of t.hits(pi))
        if (h.path === path && h.start !== null) return h.size;
    return null;
  };

  // 1. Heading1 on a body paragraph: font grows (demo Heading1 is large).
  t.clickAt(1, 150, 200);
  const p = t.state().caret.path;
  const base = sizeOf(p);
  const h1ref = sizeOf("d/0"); // demo title is Heading1
  res.info.sizes = { base, h1ref };
  t.setStyle("Heading1");
  const afterH1 = sizeOf(p);
  check("heading1 grows the font", afterH1 > base + 1);
  check("matches the demo heading size", Math.abs(afterH1 - h1ref) < 0.5);
  check("caret kept", t.state().caret && t.state().caret.path === p);

  // 2. Back to Normal restores the base size.
  t.setStyle("Normal");
  check("normal restores size", Math.abs(sizeOf(p) - base) < 0.5);

  // 3. Two undos rewind both style changes.
  t.undo(); t.undo();
  check("undos rewind", Math.abs(sizeOf(p) - base) < 0.5);

  // 4. Style survives a save round-trip (Heading1 is observable via size;
  //    Heading2/3 carry only the pStyle id in our default style set).
  t.clickAt(1, 150, 200);
  t.setStyle("Heading1");
  const h1 = sizeOf(p);
  const bytes = t.saveDocx();
  await t.loadBytes(bytes);
  await new Promise(r => setTimeout(r, 800));
  check("style survives round-trip", h1 > base + 1 && Math.abs(sizeOf(p) - h1) < 0.5);
  res.info.h1AfterReload = sizeOf(p);

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

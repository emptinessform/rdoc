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

  // Locate the endnote run among the page hits and click into it.
  let enHit = null, enPage = 0;
  const pageCount = document.querySelectorAll("#pages svg").length;
  for (let pi = 1; pi <= pageCount; pi++) {
    for (const h of t.hits(pi)) {
      if (h.path && h.path.startsWith("en/")) { enHit = h; enPage = pi; }
    }
  }
  check("endnote hit present", !!enHit);
  if (!enHit) { window.__benchResult = JSON.stringify(res); return; }
  const enPath = enHit.path;
  res.info.enPath = enPath;
  t.clickAt(enPage, enHit.x + 2, enHit.y - 2);
  check("caret in endnote", t.state().caret && t.state().caret.path === enPath);
  const before = t.textAt(enPath);
  res.info.before = before;

  // 1. Type into the endnote.
  t.type("[미주편집]");
  check("typed into endnote", t.textAt(enPath).includes("[미주편집]"));
  t.undo();
  check("undo restores endnote", t.textAt(enPath) === before);

  // 2. Enter splits the endnote paragraph; Backspace at 0 merges it back.
  t.clickAt(enPage, enHit.x + 2, enHit.y - 2);
  const off = t.state().caret.off;
  if (off > 0) {
    press("Enter");
    const p0 = t.textAt(enPath);
    const p1Path = enPath.replace(/\d+$/, m => +m + 1);
    const p1 = t.textAt(p1Path);
    res.info.split = { p0, p1: p1 };
    check("split produced tail", p1 != null && (p0 + p1) === before);
    check("caret at tail start", t.state().caret.path === p1Path && t.state().caret.off === 0);
    t.backspace();
    check("merge rejoins", t.textAt(enPath) === before && t.textAt(p1Path) == null);
  } else {
    res.info.skipSplit = "caret landed at offset 0";
  }

  // 3. Save round-trip: edit, save, reload bytes, endnote text survives.
  t.clickAt(enPage, enHit.x + 2, enHit.y - 2);
  t.type("★");
  const edited = t.textAt(enPath);
  const bytes = t.saveDocx();
  check("save produced bytes", bytes && bytes.length > 1000);
  await t.loadBytes(bytes);
  await new Promise(r => setTimeout(r, 800));
  const after = t.textAt(enPath);
  res.info.roundtrip = { edited, after };
  check("endnote survives save round-trip", after === edited);

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

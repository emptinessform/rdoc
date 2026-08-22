window.__benchResult = "pending";
(async () => {
  for (let i = 0; i < 120 && !window.__t; i++) await new Promise(r => setTimeout(r, 500));
  const t = window.__t;
  if (!t) { window.__benchResult = JSON.stringify({ error: "__t never appeared" }); return; }
  document.getElementById("demo").click();
  await new Promise(r => setTimeout(r, 1500));
  const res = { ok: true, fails: [], info: {} };
  const check = (name, cond) => { if (!cond) { res.ok = false; res.fails.push(name); } };

  const noteHits = () => t.state().total; // total hit count as a coarse signal

  // 1. insert a footnote mid-body
  t.clickAt(1, 150, 200);
  const bodyPath = t.state().caret.path;
  const bodyBefore = t.textAt(bodyPath);
  const hitsBefore = noteHits();
  t.insertFootnote();
  const caret1 = t.state().caret;
  check("caret moved into new note", !!caret1 && caret1.path.startsWith("fn/") && caret1.off === 0);
  res.info.newNote = caret1 && caret1.path;
  check("body text unchanged by ref", t.textAt(bodyPath) === bodyBefore);
  check("hit count grew (marker+note)", noteHits() > hitsBefore);

  // 2. type into the new note; it renders and reads back
  t.type("새 각주입니다");
  check("new note text", t.textAt(caret1.path) === "새 각주입니다");

  // 3. round-trip: save and reload keeps the new note
  const bytes = t.saveDocx();
  t.loadBytes(bytes);
  await new Promise(r => setTimeout(r, 800));
  check("new note survives round-trip", t.textAt(caret1.path) === "새 각주입니다");

  // 4. delete the footnote from inside it
  //    (re-establish the caret in the note first)
  let found = null;
  for (let y = 560; y <= 760 && !found; y += 5) {
    for (let x = 60; x <= 540 && !found; x += 24) {
      t.clickAt(1, x, y);
      const c = t.state().caret;
      if (c && c.path === caret1.path) found = { x, y };
    }
  }
  check("new note clickable after reload", !!found);
  if (found) {
    t.clickAt(1, found.x, found.y);
    t.deleteFootnote();
    check("note gone", t.textAt(caret1.path) == null);
    check("hits back down", noteHits() <= hitsBefore + 4);
    // 5. one undo restores note AND marker
    t.undo();
    check("undo restores note", t.textAt(caret1.path) === "새 각주입니다");
    t.redo();
    check("redo deletes again", t.textAt(caret1.path) == null);
  }

  // 6. existing demo footnote (fn/2) untouched throughout
  check("original note intact", (t.textAt("fn/2/0") || "").includes("각주 내용"));

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

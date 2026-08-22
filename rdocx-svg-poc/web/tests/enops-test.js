window.__benchResult = "pending";
(async () => {
  for (let i = 0; i < 120 && !window.__t; i++) await new Promise(r => setTimeout(r, 500));
  const t = window.__t;
  if (!t) { window.__benchResult = JSON.stringify({ error: "__t never appeared" }); return; }
  document.getElementById("demo").click();
  await new Promise(r => setTimeout(r, 1500));
  const res = { ok: true, fails: [], info: {} };
  const check = (name, cond) => { if (!cond) { res.ok = false; res.fails.push(name); } };
  const enPaths = () => {
    const out = new Set();
    const n = document.querySelectorAll("#pages svg").length;
    for (let pi = 1; pi <= n; pi++)
      for (const h of t.hits(pi))
        if (h.path && h.path.startsWith("en/")) out.add(h.path.split("/").slice(0, 2).join("/"));
    return [...out];
  };

  // Baseline: demo has exactly one endnote (en/2).
  const base = enPaths();
  res.info.base = base;
  check("one baseline endnote", base.length === 1);

  // 1. Insert a new endnote mid-body; caret should land inside the new note.
  t.clickAt(1, 150, 200);
  const bodyPath = t.state().caret.path;
  const bodyBefore = t.textAt(bodyPath);
  t.insertEndnote();
  const caret1 = t.state().caret;
  res.info.newNote = caret1 && caret1.path;
  check("caret in new endnote", caret1 && caret1.path.startsWith("en/") && caret1.off === 0);
  check("a second endnote renders", enPaths().length === 2);

  // 2. Type into the fresh (empty) endnote.
  t.type("새 미주 내용");
  check("typed into new endnote", t.textAt(caret1.path) === "새 미주 내용");

  // 3. Delete it via the caret-position dispatcher; marker and note vanish.
  t.deleteNote();
  check("note gone after delete", enPaths().length === 1 && t.textAt(caret1.path) == null);
  check("body text unchanged", t.textAt(bodyPath) === bodyBefore);

  // 4. Three undos rewind delete, typing, insert.
  t.undo();
  check("undo1 restores note+text", t.textAt(caret1.path) === "새 미주 내용");
  t.undo();
  check("undo2 empties note", t.textAt(caret1.path) === "");
  t.undo();
  check("undo3 removes note", t.textAt(caret1.path) == null && enPaths().length === 1);

  // 5. deleteNote with the caret in the pre-existing footnote still works
  //    (dispatcher falls through to the footnote branch).
  let fnHit = null, fnPage = 0;
  const n = document.querySelectorAll("#pages svg").length;
  for (let pi = 1; pi <= n; pi++)
    for (const h of t.hits(pi))
      if (h.path && h.path.startsWith("fn/")) { fnHit = h; fnPage = pi; }
  check("footnote hit present", !!fnHit);
  if (fnHit) {
    t.clickAt(fnPage, fnHit.x + 2, fnHit.y - 2);
    const fnPath = t.state().caret.path;
    t.deleteNote();
    check("footnote deleted via dispatcher", t.textAt(fnPath) == null);
    t.undo();
    check("footnote restored", t.textAt(fnPath) != null);
  }

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

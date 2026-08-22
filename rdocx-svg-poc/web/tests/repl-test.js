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

  const t4 = t.textAt("d/4"), t5 = t.textAt("d/5");
  const hdr = t.textAt("h/rId1/0"), fn0 = t.textAt("fn/2/0"), en0 = t.textAt("en/2/0");

  // 1. Ctrl+H opens the bar (replace box focused).
  press("h", { ctrlKey: true });
  check("bar opens on Ctrl+H", t.findState().open);
  check("replace box focused", document.activeElement === document.getElementById("replq"));

  // 2. Replace current: first "문장" -> "구절", advances to the next match.
  t.findQuery("문장");
  check("two matches", t.findState().count === 2);
  t.findNext(); // current = match in d/4
  t.replaceWith("구절");
  check("first replaced", t.textAt("d/4") === t4.replace("문장", "구절"));
  check("advanced to remaining match", t.findState().count === 1 && t.selText() === "문장");
  check("remaining is in d/5", t.textAt("d/5") === t5);
  t.undo();
  check("one undo restores first", t.textAt("d/4") === t4);

  // 3. Replace all across stories: "편집" appears in header, footnote,
  //    endnote, and body — one call, one undo.
  t.findQuery("편집");
  const nAll = t.findState().count;
  res.info.editCount = nAll;
  check("multi-story matches", nAll >= 3); // header + footnote + endnote
  t.replaceAllWith("수정");
  check("all replaced", t.findState().count === 0);
  check("header replaced", t.textAt("h/rId1/0") === hdr.replaceAll("편집", "수정"));
  check("footnote replaced", t.textAt("fn/2/0") === fn0.replaceAll("편집", "수정"));
  check("endnote replaced", t.textAt("en/2/0") === en0.replaceAll("편집", "수정"));
  t.undo();
  check("single undo restores every story",
        t.textAt("h/rId1/0") === hdr && t.textAt("fn/2/0") === fn0 &&
        t.textAt("en/2/0") === en0 && t.textAt("d/4") === t4);

  // 4. Non-overlapping scan: "aaaa" contains "aa" twice, not three times.
  t.clickAt(1, 150, 200);
  press("End");
  t.type("aaaa");
  t.findQuery("aa");
  check("non-overlapping matches", t.findState().count === 2);
  // replace all "aa" -> "b": "aaaa" -> "bb", and it must not re-match "b".
  t.replaceAllWith("b");
  check("replace-all is single-pass", t.findState().count === 0);
  t.undo(); t.undo(); // replace-all, typing
  check("cleanup", t.findQuery("aa") === undefined && t.findState().count === 0);

  // 5. Replacement containing the query must not loop (replace current).
  t.findQuery("구절"); // none now
  check("stale query empty", t.findState().count === 0);
  t.closeFind();

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

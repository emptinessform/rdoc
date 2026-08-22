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

  // 1. Ctrl+F opens the bar; query finds matches across stories.
  press("f", { ctrlKey: true });
  check("bar opens", t.findState().open);
  t.findQuery("문장");
  const st1 = t.findState();
  res.info.count = st1.count;
  check("matches found", st1.count >= 2);
  check("overlays drawn", st1.hl >= st1.count - 1 || st1.hl > 0);

  // 2. Enter cycles: each step selects exactly the query text.
  t.findNext();
  const s1 = t.selText();
  const p1 = JSON.stringify(document.querySelector(".selrect") && t.findState().cur);
  check("first match selected", s1 === "문장");
  t.findNext();
  const cur2 = t.findState().cur;
  check("second match selected", t.selText() === "문장" && cur2 === 1);
  t.findPrev();
  check("prev wraps back", t.findState().cur === 0);

  // 3. Case-insensitive: "GLYPHRUN" finds the table cell "GlyphRun".
  t.findQuery("GLYPHRUN");
  check("case-insensitive match", t.findState().count === 1);
  t.findNext();
  check("cell match selected", t.selText() === "GlyphRun");

  // 4. Typing over the current match replaces it (one undo), and the match
  //    list refreshes after the edit.
  const cellBefore = t.textAt("d/10.1.1.0");
  press("X");
  check("typed over match", t.textAt("d/10.1.1.0") === "X");
  check("matches refreshed after edit", t.findState().count === 0);
  t.undo();
  check("one undo restores", t.textAt("d/10.1.1.0") === cellBefore);

  // 5. Search reaches non-body stories (header text).
  t.findQuery("머리글");
  res.info.hdr = t.findState().count;
  check("header story searched", t.findState().count >= 1);

  // 6. Esc closes and clears overlays.
  t.closeFind();
  const st1b = t.findState();
  check("closed and cleared", !st1b.open && st1b.hl === 0);

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

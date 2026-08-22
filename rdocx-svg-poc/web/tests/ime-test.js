window.__benchResult = "pending";
(async () => {
  for (let i = 0; i < 120 && !window.__t; i++) await new Promise(r => setTimeout(r, 500));
  const t = window.__t;
  if (!t) { window.__benchResult = JSON.stringify({ error: "__t never appeared" }); return; }
  await t.loadUrl("./demo.docx");
  const snap = () => t.paraTexts().join("");
  const res = { ok: true, fails: [] };
  const check = (name, cond) => { if (!cond) { res.ok = false; res.fails.push(name); } };

  t.clickAt(1, 150, 150);
  if (!t.state().caret) { window.__benchResult = JSON.stringify({ error: "no caret" }); return; }
  const p = t.state().caret.path;
  const base = snap();
  const basePara = t.textAt(p);

  // 1. stepwise composition: intermediate jamo visible, replaced, committed
  t.imeStart();
  t.imeUpdate("ㅂ");                    // ㅂ
  const mid1 = t.textAt(p);
  t.imeUpdate("바");                    // 바
  const mid2 = t.textAt(p);
  t.imeEnd("박");                       // 박
  const committed = t.textAt(p);
  check("mid1 shows jamo", mid1.includes("ㅂ") && !basePara.includes("ㅂ"));
  check("mid2 replaced jamo", mid2.includes("바") && !mid2.includes("ㅂ"));
  check("commit final only", committed.includes("박") && !committed.includes("바"));

  // 2. one undo removes the whole syllable; redo restores it
  t.undo();
  check("single undo removes syllable", snap() === base);
  t.redo();
  check("redo restores syllable", t.textAt(p) === committed);
  t.undo();
  check("back to base", snap() === base);

  // 3. multi-syllable: two compositions in sequence ("한" then "글")
  t.clickAt(1, 150, 150);
  const q = t.state().caret.path;
  t.simIme(["ㅎ", "하", "한"]); // ㅎ 하 한
  t.simIme(["ㄱ", "그", "글"]); // ㄱ 그 글
  check("two syllables committed", t.textAt(q).includes("한글"));
  t.undo(); t.undo();
  check("two undos remove both", snap() === base);

  // 4. cancelled composition leaves no undo entry
  t.clickAt(1, 150, 150);
  t.type("x");
  const withX = snap();
  t.imeStart();
  t.imeUpdate("ㅁ");                    // ㅁ
  t.imeEnd("");                             // cancel
  check("cancel restores text", snap() === withX);
  t.undo();
  check("undo after cancel removes x, not a no-op", snap() === base);

  // 5. click mid-composition finalizes the preedit as one unit
  t.clickAt(1, 150, 150);
  t.imeStart();
  t.imeUpdate("하");                    // 하
  t.clickAt(1, 150, 300);
  const afterClick = snap();
  check("preedit kept after click", afterClick !== base && afterClick.includes("하"));
  t.undo();
  check("one undo removes clicked-away preedit", snap() === base);

  // 6. selection replaced by composition, restored by one undo
  const selText = t.select(1, 120, 150, 220, 150);
  if (selText) {
    t.imeStart();
    t.imeUpdate("ㅇ");                  // ㅇ
    t.imeEnd("안");                     // 안
    check("selection replaced by composition", snap() !== base && snap().includes("안"));
    t.undo();
    check("one undo restores selection edit", snap() === base);
  } else {
    res.fails.push("selection test skipped: select() returned null");
  }

  // 7. regression: plain typing / backspace / enter / undo loop
  t.clickAt(1, 150, 150);
  t.type("ab");
  t.backspace();
  t.enter();
  t.undo(); t.undo(); t.undo();
  check("plain editing regression", snap() === base);

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

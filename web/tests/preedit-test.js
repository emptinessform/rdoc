window.__benchResult = "pending";
(async () => {
  for (let i = 0; i < 120 && !window.__t; i++) await new Promise(r => setTimeout(r, 500));
  const t = window.__t;
  if (!t) { window.__benchResult = JSON.stringify({ error: "__t never appeared" }); return; }
  await t.loadUrl("./demo.docx");
  const res = { ok: true, fails: [] };
  const check = (name, cond) => { if (!cond) { res.ok = false; res.fails.push(name); } };
  const preedits = () => [...document.querySelectorAll(".preedit")];

  t.clickAt(1, 150, 150);
  const base = t.paraTexts().join("");

  // 1. underline appears during composition, tracks the preedit width
  t.imeStart();
  check("no underline before first update", preedits().length === 0);
  t.imeUpdate("ㅂ");
  const u1 = preedits();
  check("underline appears on update", u1.length >= 1);
  const w1 = u1.length ? (+u1[0].getAttribute("x2") - +u1[0].getAttribute("x1")) : 0;
  check("underline has width", w1 > 0);
  t.imeUpdate("바나나");
  const u2 = preedits();
  const w2 = u2.length ? u2.reduce((s, l) => s + (+l.getAttribute("x2") - +l.getAttribute("x1")), 0) : 0;
  check("underline widens with longer preedit", w2 > w1);

  // 1b. underline geometry sits at the caret's line (same page svg, y below baseline)
  const caretLine = document.querySelector(".caret");
  if (caretLine && u2.length) {
    const uy = +u2[0].getAttribute("y1");
    const cy2 = +caretLine.getAttribute("y2"); // caret bottom = y + 0.25*size
    check("underline near caret baseline", Math.abs(uy - cy2) < 0.2 * (cy2 - +caretLine.getAttribute("y1")) + 2);
  } else {
    res.fails.push("geometry check skipped (no caret or underline)");
  }

  // 2. commit clears the underline, text stays
  t.imeEnd("반");
  check("underline gone after commit", preedits().length === 0);
  check("committed text present", t.paraTexts().join("").includes("반"));
  t.undo();

  // 3. cancel clears the underline
  t.clickAt(1, 150, 150);
  t.imeStart();
  t.imeUpdate("ㅁ");
  check("underline during second composition", preedits().length >= 1);
  t.imeEnd("");
  check("underline gone after cancel", preedits().length === 0);
  check("text unchanged after cancel", t.paraTexts().join("") === base);

  // 4. click mid-composition clears the underline (finalize path)
  t.imeStart();
  t.imeUpdate("하");
  check("underline before click-away", preedits().length >= 1);
  t.clickAt(1, 150, 300);
  check("underline gone after click-away", preedits().length === 0);
  t.undo();
  check("doc back to base", t.paraTexts().join("") === base);

  // 5. prior IME behavior still intact (quick smoke)
  t.clickAt(1, 150, 150);
  t.simIme(["ㅎ", "하", "한"]);
  check("commit still works", t.paraTexts().join("").includes("한"));
  t.undo();
  check("one undo per syllable still works", t.paraTexts().join("") === base);

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

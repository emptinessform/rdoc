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
  const hit = (pp) => { for (let pi = 1; pi <= 2; pi++) for (const h of t.hits(pi)) if (h.path === pp && h.start !== null) return { h, page: pi }; return null; };

  // 1. Same-paragraph toggle still works through the new path.
  t.clickAt(1, 150, 200);
  const p = t.state().caret.path;
  for (let i = 0; i < 3; i++) press("ArrowRight", { shiftKey: true });
  const r1 = t.selRanges();
  check("ranges resolve", r1 && r1.length === 1);
  press("b", { ctrlKey: true });
  check("bold set", t.fmtOn(r1, "b") === true);
  t.undo();
  check("undo clears bold", t.fmtOn(r1, "b") === false);

  // 2. Cross-paragraph selection bolds both paragraphs in one entry.
  const a = hit("d/4"), b = hit("d/5");
  const mkSel = () => t.select(a.page, a.h.x + a.h.adv[0] + 0.1, a.h.y - 1, b.h.x + b.h.adv[0] + b.h.adv[1] + 0.1, b.h.y - 1);
  mkSel();
  const r2 = t.selRanges();
  res.info.r2 = r2;
  check("two ranges", r2 && r2.length === 2);
  press("b", { ctrlKey: true });
  check("both bold", t.fmtOn(r2, "b") === true);
  t.undo();
  check("one undo clears both", t.fmtOn(r2, "b") === false);

  // 3. Word semantics: mixed state -> set everywhere; all-on -> clear.
  //    Bold only the d/4 half, then toggle over both: everything turns on.
  mkSel();
  press("b", { ctrlKey: true }); // both on
  mkSel();
  press("b", { ctrlKey: true }); // all-on -> both off
  check("second toggle clears (all-on rule)", t.fmtOn(r2, "b") === false);
  // Bold just d/4's fragment, then a cross toggle must SET both (mixed).
  const r4only = [r2[0]];
  t.select(a.page, a.h.x + a.h.adv[0] + 0.1, a.h.y - 1, a.h.x + a.h.adv[0] + a.h.adv[1] + a.h.adv[2] + 0.1, a.h.y - 1);
  press("b", { ctrlKey: true });
  mkSel();
  press("b", { ctrlKey: true });
  check("mixed state sets everywhere", t.fmtOn(r2, "b") === true);
  t.undo(); t.undo(); t.undo(); t.undo();
  check("undos rewind", t.fmtOn(r2, "b") === false);

  // 4. Italic across a scatter (cell) selection.
  const ca = hit("d/10.1.0.0"), cb = hit("d/10.1.1.0");
  t.select(ca.page, ca.h.x + 0.1, ca.h.y - 1, cb.h.x + cb.h.adv[0] + cb.h.adv[1] + 0.1, cb.h.y - 1);
  const r3 = t.selRanges();
  check("scatter ranges", r3 && r3.length === 2 && r3[0].path !== r3[1].path);
  press("i", { ctrlKey: true });
  check("scatter italic on", t.fmtOn(r3, "i") === true);
  t.undo();
  check("scatter undo", t.fmtOn(r3, "i") === false);

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

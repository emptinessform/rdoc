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
  const clickCell = (pp) => { const c = hit(pp); t.clickAt(c.page, c.h.x + 2, c.h.y - 2); };

  // 1. Tab moves to the next cell selecting its content.
  clickCell("d/10.1.0.0"); // "Text"
  press("Tab");
  check("next cell selected", t.selText() === "GlyphRun");

  // 2. Tab again then wraps to the next row's first cell.
  press("Tab"); // -> (1,2) "<use href..."
  const s2 = t.selText();
  press("Tab"); // -> (2,0) "Border"
  res.info.s2 = s2;
  check("row wrap", t.selText() === "Border");

  // 3. Shift+Tab goes back to the previous row's last cell.
  press("Tab", { shiftKey: true }); // back to (1,2)
  check("shift-tab back", t.selText() === s2);

  // 4. Tab at the LAST cell appends a row and lands in its first cell.
  clickCell("d/10.3.2.0"); // "<rect>" last cell
  const rowsBefore = t.textAt("d/10.4.0.0");
  check("no 5th row yet", rowsBefore == null);
  press("Tab");
  check("new row created and entered",
        t.state().caret && t.state().caret.path === "d/10.4.0.0" && t.textAt("d/10.4.0.0") === "");
  t.type("추가행");
  check("typing lands in the new row", t.textAt("d/10.4.0.0") === "추가행");
  t.undo(); t.undo(); // typing, row insert
  check("undo rewinds", t.textAt("d/10.4.0.0") == null);

  // 5. Shift+Tab at the first cell stays put.
  clickCell("d/10.0.0.0");
  press("Tab", { shiftKey: true });
  check("first cell stays", t.state().caret && t.state().caret.path.startsWith("d/10.0.0"));

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

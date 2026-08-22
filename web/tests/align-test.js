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
  const firstX = (path) => {
    for (let pi = 1; pi <= document.querySelectorAll("#pages svg").length; pi++)
      for (const h of t.hits(pi))
        if (h.path === path && h.start === 0) return h.x;
    return null;
  };

  // 1. Ctrl+E centers the caret paragraph (its first line moves right).
  t.clickAt(1, 150, 200);
  const p = t.state().caret.path;
  const x0 = firstX(p);
  press("e", { ctrlKey: true });
  const xC = firstX(p);
  res.info.center = { x0, xC };
  check("center moves line right", xC > x0 + 20);
  check("caret survives", t.state().caret && t.state().caret.path === p);

  // 2. Ctrl+R pushes further right; Ctrl+L restores the left edge.
  press("r", { ctrlKey: true });
  const xR = firstX(p);
  check("right beyond center", xR > xC);
  press("l", { ctrlKey: true });
  check("left restores edge", Math.abs(firstX(p) - x0) < 0.5);

  // 3. Three undos rewind the three alignment entries.
  t.undo(); t.undo(); t.undo();
  check("undos restore original", Math.abs(firstX(p) - x0) < 0.5);

  // 4. Selection across two body paragraphs aligns both in ONE entry.
  const t4x = firstX("d/4"), t5x = firstX("d/5");
  const hit = (pp) => { for (let pi = 1; pi <= 2; pi++) for (const h of t.hits(pi)) if (h.path === pp && h.start !== null) return { h, page: pi }; return null; };
  const a = hit("d/4"), b = hit("d/5");
  t.select(a.page, a.h.x + a.h.adv[0] + 0.1, a.h.y - 1, b.h.x + b.h.adv[0] + 0.1, b.h.y - 1);
  t.align("c");
  check("both centered", firstX("d/4") > t4x + 20 && firstX("d/5") > t5x + 20);
  t.undo();
  check("one undo restores both", Math.abs(firstX("d/4") - t4x) < 0.5 && Math.abs(firstX("d/5") - t5x) < 0.5);

  // 5. Table cell paragraph aligns too, and it round-trips through save.
  const cell = "d/10.1.0.0";
  const cx0 = firstX(cell);
  const ch = hit(cell);
  t.clickAt(ch.page, ch.h.x + 2, ch.h.y - 2);
  t.align("r");
  const cxR = firstX(cell);
  check("cell right-aligned", cxR > cx0 + 5);
  const bytes = t.saveDocx();
  await t.loadBytes(bytes);
  await new Promise(r => setTimeout(r, 800));
  check("alignment survives save round-trip", Math.abs(firstX(cell) - cxR) < 0.5);

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

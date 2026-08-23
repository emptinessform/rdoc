window.__benchResult = "pending";
(async () => {
  for (let i = 0; i < 120 && !window.__t; i++) await new Promise(r => setTimeout(r, 500));
  const t = window.__t;
  if (!t) { window.__benchResult = JSON.stringify({ error: "__t never appeared" }); return; }
  document.getElementById("demo").click();
  await new Promise(r => setTimeout(r, 1500));
  const res = { ok: true, fails: [], info: {} };
  const check = (name, cond) => { if (!cond) { res.ok = false; res.fails.push(name); } };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const firstHit = (p) => t.hits(1).filter(h => h.path === p && h.start !== null)
    .sort((a, b) => a.start - b.start)[0];

  // Demo table row 1: cells "Text" | "GlyphRun" | '<use href="#g..">'
  const T = "d/10";
  const c0 = `${T}.1.0.0`, c1 = `${T}.1.1.0`, c2 = `${T}.1.2.0`;
  const texts0 = [t.textAt(c0), t.textAt(c1), t.textAt(c2)];
  res.info.texts0 = texts0;
  check("three cells present", texts0.every(x => x != null));
  const xThirdBefore = firstHit(c2).x;

  // 1. Merge cells 0 and 1 via a cross-cell (scatter) selection.
  const a = firstHit(c0), b = firstHit(c1);
  t.select(1, a.x + 0.1, a.y - 2, b.x + b.adv[0] + b.adv[1] + 0.1, b.y - 2);
  t.mergeCells();
  await wait(400);
  check("merged cell keeps first text", t.textAt(c0) === texts0[0]);
  check("second cell text became para 2", t.textAt(`${T}.1.0.1`) === texts0[1]);
  check("old third cell moved to index 1", t.textAt(c1) === texts0[2]);
  check("row now has two cells", t.textAt(c2) == null);
  const xSecondAfter = firstHit(c1) && firstHit(c1).x;
  res.info.x = { xThirdBefore, xSecondAfter };
  check("last cell stays at its grid column", Math.abs(xSecondAfter - xThirdBefore) < 1);
  check("caret in merged cell", t.state().caret && t.state().caret.path === c0);

  // 2. Split restores three cells; content stays in the first.
  const f = firstHit(c0);
  t.clickAt(1, f.x + 0.5, f.y - 2);
  t.splitCell();
  await wait(400);
  check("split restores cell count", t.textAt(c2) != null);
  check("split keeps content in first cell", t.textAt(c0) === texts0[0] && t.textAt(`${T}.1.0.1`) === texts0[1]);
  check("inserted cell is empty", t.textAt(c1) === "");
  check("last cell text back at index 2", t.textAt(c2) === texts0[2]);

  // 3. Undo unwinds split then merge back to the original row.
  t.undo();
  await wait(300);
  check("undo restores merge", t.textAt(c2) == null);
  t.undo();
  await wait(300);
  check("second undo restores original row", t.textAt(c1) === texts0[1] && t.textAt(c2) === texts0[2]);

  // 4. Guard: a same-paragraph selection refuses to merge.
  const p3 = firstHit("d/3");
  t.select(1, p3.x + 0.1, p3.y - 2, p3.x + 20, p3.y - 2);
  t.mergeCells(); // should only report, not mutate
  await wait(200);
  check("non-cell selection refused", t.textAt(c1) === texts0[1] && t.textAt(c2) === texts0[2]);

  // 5. Round-trip keeps a merge (history is cleared by load, so last).
  const a2 = firstHit(c0), b2 = firstHit(c1);
  t.select(1, a2.x + 0.1, a2.y - 2, b2.x + b2.adv[0] + b2.adv[1] + 0.1, b2.y - 2);
  t.mergeCells();
  await wait(400);
  const bytes = t.saveDocx();
  await t.loadBytes(bytes);
  await wait(800);
  check("round-trip keeps merge", t.textAt(`${T}.1.0.1`) === texts0[1] && t.textAt(c2) == null);

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

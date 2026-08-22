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
  const hitFor = (path) => {
    const n = document.querySelectorAll("#pages svg").length;
    for (let pi = 1; pi <= n; pi++)
      for (const h of t.hits(pi))
        if (h.path === path && h.start !== null) return { h, page: pi };
    return null;
  };

  // Table data cells: "Text" cell d/10.1.0.0, "GlyphRun" cell d/10.1.1.0
  // (row 1 of the demo table). Confirm the paths first.
  const cellA = "d/10.1.0.0", cellB = "d/10.1.1.0";
  const ta = t.textAt(cellA), tb = t.textAt(cellB);
  res.info.cells = { ta, tb };
  check("cell paths resolve", ta === "Text" && tb === "GlyphRun");

  // 1. Multi-paragraph selection inside ONE cell: split the cell paragraph,
  //    then select across the two halves and delete — Word-style rejoin.
  const hA0 = hitFor(cellA);
  t.clickAt(hA0.page, hA0.h.x + 2, hA0.h.y - 2);
  const capo = t.state().caret;
  check("caret in cell", capo && capo.path === cellA);
  // put caret after "Te" (off 2): use End/Home arithmetic via direct click offset
  // simpler: select nothing, set caret via clickAt then move with ArrowRight/Left
  press("Home");
  press("ArrowRight");
  press("ArrowRight");
  press("Enter");
  const tailPath = "d/10.1.0.1";
  check("cell split", t.textAt(cellA) === "Te" && t.textAt(tailPath) === "xt");
  // Shift+End on first half then Shift+Down would leave the cell; instead
  // extend selection over the boundary with Shift+ArrowRight (crosses via
  // keyboard is same-paragraph only) — use t.select with coordinates.
  const hA = hitFor(cellA), hT = hitFor(tailPath);
  // From after "T" (off 1) to after "x" in the tail (off 1): selects "e\nx".
  const selTxt = t.select(hA.page, hA.h.x + hA.h.adv[0] + 0.1, hA.h.y - 1, hT.h.x + hT.h.adv[0] + 0.1, hT.h.y - 1);
  res.info.selTxt = selTxt;
  check("selection spans the split", selTxt === "e\nx");
  t.deleteSel();
  res.info.afterInCell = { a: t.textAt(cellA), tail: t.textAt(tailPath) };
  check("in-cell cross-paragraph delete merges", t.textAt(cellA) === "Tt" && t.textAt(tailPath) == null);
  t.undo(); t.undo(); // delete, split
  check("undos restore cell", t.textAt(cellA) === "Text" && t.textAt(tailPath) == null);

  // 2. Cross-cell selection: from inside "Text" into "GlyphRun" — scatter
  //    delete clears per cell, structure stays.
  const hA2 = hitFor(cellA), hB2 = hitFor(cellB);
  const st = t.select(hA2.page, hA2.h.x + hA2.h.adv[0] + 0.1, hA2.h.y - 1, hB2.h.x + hB2.h.adv[0] + hB2.h.adv[1] + 0.1, hB2.h.y - 1);
  res.info.crossSel = st;
  check("cross-cell selection exists", !!st && st.length >= 3);
  t.deleteSel();
  const a3 = t.textAt(cellA), b3 = t.textAt(cellB);
  res.info.afterCross = { a3, b3 };
  check("head cell trimmed", a3 === "T");
  check("tail cell trimmed", b3 === "yphRun");
  check("cells still exist as paragraphs", a3 != null && b3 != null);
  t.undo();
  check("one undo restores both cells", t.textAt(cellA) === "Text" && t.textAt(cellB) === "GlyphRun");

  // 3. Typing over a cross-cell selection: text lands in the first cell.
  const st2 = t.select(hA2.page, hA2.h.x + hA2.h.adv[0] + 0.1, hA2.h.y - 1, hB2.h.x + hB2.h.adv[0] + hB2.h.adv[1] + 0.1, hB2.h.y - 1);
  check("reselected", !!st2);
  t.replaceSel("X");
  res.info.afterType = { a: t.textAt(cellA), b: t.textAt(cellB) };
  check("typed over cross-cell", t.textAt(cellA) === "TX" && t.textAt(cellB) === "yphRun");
  check("caret after typed char", t.state().caret && t.state().caret.path === cellA && t.state().caret.off === 2);
  t.undo();
  check("one undo restores typing", t.textAt(cellA) === "Text" && t.textAt(cellB) === "GlyphRun");

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

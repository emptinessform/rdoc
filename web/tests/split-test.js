window.__benchResult = "pending";
(async () => {
  for (let i = 0; i < 120 && !window.__t; i++) await new Promise(r => setTimeout(r, 500));
  const t = window.__t;
  if (!t) { window.__benchResult = JSON.stringify({ error: "__t never appeared" }); return; }
  document.getElementById("demo").click();
  await new Promise(r => setTimeout(r, 1500));
  const res = { ok: true, fails: [], info: {} };
  const check = (name, cond) => { if (!cond) { res.ok = false; res.fails.push(name); } };
  const sib = (p, d) => { const m = p.match(/^(.*?)(\d+)$/); return m ? m[1] + (+m[2] + d) : null; };

  const probe = (yLo, yHi, want, dots) => {
    for (let y = yLo; y <= yHi; y += 6) {
      for (let x = 60; x <= 540; x += 24) {
        t.clickAt(1, x, y);
        const c = t.state().caret;
        if (c && c.path.startsWith(want) && (dots === undefined || c.path.includes(".") === dots))
          return { path: c.path, x, y, off: c.off };
      }
    }
    return null;
  };

  // ---- 1. table cell: Enter splits, Backspace merges back -----------------
  const cell = probe(300, 620, "d/", true);
  res.info.cell = cell && cell.path;
  check("cell reachable", !!cell);
  if (cell) {
    t.clickAt(1, cell.x, cell.y);
    const path = t.state().caret.path;
    const full = t.textAt(path);
    const off = t.state().caret.off;
    t.enter();
    const headPath = path, tailPath = sib(path, +1);
    const head = t.textAt(headPath), tail = t.textAt(tailPath);
    check("cell split parts", head === full.slice(0, off) && tail === full.slice(off));
    check("cell caret on tail", t.state().caret.path === tailPath && t.state().caret.off === 0);
    // Backspace at offset 0 merges back
    t.backspace();
    check("cell merge restores", t.textAt(headPath) === full && t.textAt(tailPath) !== tail);
    check("cell caret after merge", t.state().caret.path === headPath && t.state().caret.off === head.length);
    t.undo(); t.undo();
    check("cell undo x2 back to base", t.textAt(path) === full);
  }

  // ---- 2. header: Enter + merge -------------------------------------------
  const hdr = probe(20, 70, "h/");
  res.info.hdr = hdr && hdr.path;
  check("header reachable", !!hdr);
  if (hdr) {
    t.clickAt(1, hdr.x, hdr.y);
    const path = t.state().caret.path;
    const full = t.textAt(path);
    const off = t.state().caret.off;
    t.enter();
    check("header split", t.textAt(path) === full.slice(0, off) && t.textAt(sib(path, +1)) === full.slice(off));
    t.backspace();
    check("header merge restores", t.textAt(path) === full);
    t.undo(); t.undo();
    check("header undo", t.textAt(path) === full);
  }

  // ---- 3. footnote: Enter + merge ------------------------------------------
  const note = probe(600, 750, "fn/");
  res.info.note = note && note.path;
  check("footnote reachable", !!note);
  if (note) {
    t.clickAt(1, note.x, note.y);
    const path = t.state().caret.path;
    const full = t.textAt(path);
    const off = t.state().caret.off;
    t.enter();
    check("footnote split", t.textAt(path) === full.slice(0, off) && t.textAt(sib(path, +1)) === full.slice(off));
    t.backspace();
    check("footnote merge restores", t.textAt(path) === full);
    t.undo(); t.undo();
    check("footnote undo", t.textAt(path) === full);
  }

  // ---- 4. body: Enter + merge через the unified path route ----------------
  t.clickAt(1, 150, 200);
  const bp = t.state().caret.path;
  const bFull = t.textAt(bp);
  const bOff = t.state().caret.off;
  t.enter();
  check("body split", t.textAt(bp) === bFull.slice(0, bOff) && t.textAt(sib(bp, +1)) === bFull.slice(bOff));
  check("body caret on tail", t.state().caret.path === sib(bp, +1));
  t.backspace();
  check("body merge restores", t.textAt(bp) === bFull);
  t.undo(); t.undo();
  check("body undo", t.textAt(bp) === bFull);

  // ---- 5. merge refusal: first paragraph of a container --------------------
  if (cell) {
    // find a cell paragraph whose last segment is 0 and try backspace at 0
    t.clickAt(1, cell.x, cell.y);
    const p0 = t.state().caret.path;
    if (p0.endsWith(".0")) {
      const before = t.textAt(p0);
      // move caret to offset 0 then backspace: merge must refuse, doc intact
      for (let i = 0; i < 50 && t.state().caret.off > 0; i++) t.backspace();
      // (we may have deleted chars getting to 0; just verify no crash and
      // that a backspace AT 0 leaves the container structure alone)
      t.backspace();
      check("first-cell-paragraph merge refused quietly", t.textAt(p0) !== null);
      while (t.textAt(p0) !== before) { t.undo(); if (t.state === null) break; }
    }
  }

  // ---- 6. split survives a save round-trip ---------------------------------
  if (hdr) {
    t.clickAt(1, hdr.x, hdr.y);
    const path = t.state().caret.path;
    const full = t.textAt(path);
    const off = t.state().caret.off;
    t.enter();
    const bytes = t.saveDocx();
    t.loadBytes(bytes);
    await new Promise(r => setTimeout(r, 800));
    check("header split survives round-trip",
      t.textAt(path) === full.slice(0, off) && t.textAt(sib(path, +1)) === full.slice(off));
  }

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

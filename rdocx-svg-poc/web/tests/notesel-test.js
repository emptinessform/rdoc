window.__benchResult = "pending";
(async () => {
  for (let i = 0; i < 120 && !window.__t; i++) await new Promise(r => setTimeout(r, 500));
  const t = window.__t;
  if (!t) { window.__benchResult = JSON.stringify({ error: "__t never appeared" }); return; }
  document.getElementById("demo").click();
  await new Promise(r => setTimeout(r, 1500));
  const res = { ok: true, fails: [], info: {} };
  const check = (name, cond) => { if (!cond) { res.ok = false; res.fails.push(name); } };
  const svgs = () => document.querySelectorAll("#pages svg");
  const hitFor = (path) => {
    for (let pi = 1; pi <= svgs().length; pi++)
      for (const h of t.hits(pi))
        if (h.path === path && h.start !== null) return { h, page: pi };
    return null;
  };
  const notePaths = (prefix) => {
    const out = new Set();
    for (let pi = 1; pi <= svgs().length; pi++)
      for (const h of t.hits(pi))
        if (h.path && h.path.startsWith(prefix)) out.add(h.path.split("/").slice(0, 2).join("/"));
    return [...out];
  };

  // Korean hits come as per-syllable segments, so map a paragraph offset to
  // page coordinates via the segment that covers it.
  const xAt = (path, off) => {
    for (let pi = 1; pi <= svgs().length; pi++)
      for (const h of t.hits(pi)) {
        if (h.path !== path || h.start === null) continue;
        const len = h.adv.length;
        if (off < h.start || off > h.start + len) continue;
        let x = h.x;
        for (let i = 0; i < off - h.start; i++) x += h.adv[i];
        return { page: pi, x: x + 0.1, y: h.y - 1 };
      }
    return null;
  };

  // Demo: d/4 "이 문장에는 각주가 달려 있습니다" + footnote ref at end,
  //       d/5 "그리고 이 문장에는 미주가 달려 있습니다" + endnote ref at end.
  const t4 = t.textAt("d/4"), t5 = t.textAt("d/5");
  check("baseline notes present", notePaths("fn/").length === 1 && notePaths("en/").length === 1);

  // 1. Cross-paragraph selection d/4[2..] -> d/5[..3] covers the footnote
  //    marker (end of d/4) but NOT the endnote marker (end of d/5):
  //    footnote must vanish with the text, endnote must survive.
  const pa1 = xAt("d/4", 2), pb1 = xAt("d/5", 3);
  t.select(pa1.page, pa1.x, pa1.y, pb1.x, pb1.y);
  t.deleteSel();
  res.info.merged = t.textAt("d/4");
  check("paragraphs merged", t.textAt("d/4") === [...t4].slice(0, 2).join("") + [...t5].slice(3).join(""));
  check("footnote deleted with its marker", notePaths("fn/").length === 0);
  check("endnote survived (marker outside range)", notePaths("en/").length === 1);
  t.undo();
  check("one undo restores text and note", t.textAt("d/4") === t4 && t.textAt("d/5") === t5 && notePaths("fn/").length === 1);

  // 2. Same-paragraph interior range covering a marker: put a footnote
  //    mid-paragraph, then select around it and type over it.
  const pc = xAt("d/4", 2);
  t.clickAt(pc.page, pc.x, pc.y - 1);
  t.insertFootnote();                       // caret jumps into new note
  const newNotes = notePaths("fn/");
  res.info.newNotes = newNotes;
  check("second footnote exists", newNotes.length === 2);
  const pa2 = xAt("d/4", 1), pb2 = xAt("d/4", 3);
  t.select(pa2.page, pa2.x, pa2.y, pb2.x, pb2.y);
  t.replaceSel("★");
  res.info.afterReplace = t.textAt("d/4");
  check("typed over marker range", t.textAt("d/4") === [...t4].slice(0, 1).join("") + "★" + [...t4].slice(3).join(""));
  check("mid-paragraph footnote deleted", notePaths("fn/").length === 1);
  t.undo(); t.undo(); // replace, insertFootnote
  check("undos restore baseline", t.textAt("d/4") === t4 && notePaths("fn/").length === 1);

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

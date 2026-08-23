window.__benchResult = "pending";
(async () => {
  for (let i = 0; i < 120 && !window.__t; i++) await new Promise(r => setTimeout(r, 500));
  const t = window.__t;
  if (!t) { window.__benchResult = JSON.stringify({ error: "__t never appeared" }); return; }
  const res = { ok: true, fails: [], info: {} };
  const check = (name, cond) => { if (!cond) { res.ok = false; res.fails.push(name); } };

  // fontmap-test.docx: four paragraphs with the IDENTICAL text
  // "가나다 abcdefg test 123", asking for 맑은 고딕(d/0), 굴림(d/1),
  // 바탕(d/2), 궁서(d/3). With the open-font set, 굴림 shapes with the
  // sans (Pretendard) and 바탕/궁서 with the serif (NanumMyeongjo).
  // Korean syllables are full-width (1em) in both fonts, so the
  // discriminator is the paragraph's total advance, dominated by the
  // Latin part where the two designs differ.
  await t.loadUrl("./fontmap-test.docx?v=" + Date.now());
  await new Promise(r => setTimeout(r, 800));

  const totalWidth = (path) => {
    let w = 0, seen = false;
    for (const h of t.hits(1)) {
      if (h.path !== path) continue;
      seen = true;
      for (const a of h.adv) w += a;
    }
    return seen ? w : null;
  };
  const w = {
    malgun: totalWidth("d/0"),   // local malgun.ttf if present, else sans
    gulim: totalWidth("d/1"),    // -> Pretendard
    batang: totalWidth("d/2"),   // -> NanumMyeongjo
    gungsuh: totalWidth("d/3"),  // -> NanumMyeongjo
  };
  res.info.widths = w;

  check("all four paragraphs shaped", [w.malgun, w.gulim, w.batang, w.gungsuh].every((v) => v && v > 0));
  if (res.ok) {
    // 굴림(sans) vs 바탕(serif): different fonts, different Latin metrics.
    check("gulim and batang use different fonts", Math.abs(w.gulim - w.batang) > 0.05);
    // 바탕 and 궁서 both map to the serif: identical shaping.
    check("batang and gungsuh share the serif", Math.abs(w.batang - w.gungsuh) < 1e-6);
  }

  const s = t.state();
  res.info.mapped = s.mapped;
  res.info.total = s.total;
  check("all runs provenance-mapped", s.mapped === s.total && s.total > 0);

  // Applying a family over a selection re-shapes with that font: turn the
  // 굴림(sans) paragraph into 바탕 — its total width must become the
  // serif paragraph's width — and one undo restores the sans width.
  if (res.ok) {
    const selAll = (path) => {
      const segs = t.hits(1).filter((h) => h.path === path && h.start !== null)
        .sort((x, y) => x.start - y.start);
      const f = segs[0], l = segs[segs.length - 1];
      return t.select(1, f.x + 0.1, f.y - 2, l.x + l.adv.reduce((x, y) => x + y, 0) - 0.1, l.y - 2);
    };
    selAll("d/1");
    t.fontFamily("바탕");
    await new Promise((r) => setTimeout(r, 400));
    const applied = totalWidth("d/1");
    res.info.familyApplied = applied;
    check("family change reshapes to serif", Math.abs(applied - w.batang) < 1e-6);
    t.undo();
    await new Promise((r) => setTimeout(r, 400));
    check("family undo restores sans", Math.abs(totalWidth("d/1") - w.gulim) < 1e-6);
  }

  window.__benchResult = JSON.stringify(res);
})();

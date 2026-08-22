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
  const sizesFor = (path) => {
    const out = [];
    for (let pi = 1; pi <= document.querySelectorAll("#pages svg").length; pi++)
      for (const h of t.hits(pi))
        if (h.path === path && h.start !== null)
          for (let k = 0; k < h.adv.length; k++) out.push({ off: h.start + k, size: h.size });
    return out.sort((a, b) => a.off - b.off);
  };

  // 1. Select 4 chars and set 24pt: exactly that range renders at 24.
  t.clickAt(1, 150, 200);
  const p = t.state().caret.path;
  const off = t.state().caret.off;
  const base = sizesFor(p)[0].size;
  for (let i = 0; i < 4; i++) press("ArrowRight", { shiftKey: true });
  t.fontSize(24);
  const after = sizesFor(p);
  res.info.base = base;
  check("range is 24pt", after.filter((c) => c.off >= off && c.off < off + 4).every((c) => c.size === 24));
  check("outside unchanged", after.filter((c) => c.off < off || c.off >= off + 4).every((c) => c.size === base));
  check("caret at range start", t.state().caret && t.state().caret.off === off);
  t.undo();
  check("one undo restores size", sizesFor(p).every((c) => c.size === base));

  // 2. Cross-paragraph (sibling) selection sizes both in one entry.
  const hit = (pp) => { for (let pi = 1; pi <= 2; pi++) for (const h of t.hits(pi)) if (h.path === pp && h.start !== null) return { h, page: pi }; return null; };
  const a = hit("d/4"), b = hit("d/5");
  t.select(a.page, a.h.x + a.h.adv[0] + 0.1, a.h.y - 1, b.h.x + b.h.adv[0] + 0.1, b.h.y - 1);
  t.fontSize(18);
  check("head tail sized", sizesFor("d/4").some((c) => c.size === 18) && sizesFor("d/5")[0].size === 18);
  t.undo();
  check("one undo restores both paragraphs",
        sizesFor("d/4").every((c) => c.size === base) && sizesFor("d/5").every((c) => c.size === base));

  // 3. Size survives a save round-trip.
  t.clickAt(1, 150, 200);
  for (let i = 0; i < 2; i++) press("ArrowRight", { shiftKey: true });
  t.fontSize(30);
  const bytes = t.saveDocx();
  await t.loadBytes(bytes);
  await new Promise(r => setTimeout(r, 800));
  check("size survives round-trip", sizesFor(p).some((c) => c.size === 30));

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

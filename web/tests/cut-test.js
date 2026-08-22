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

  // 1. Same-paragraph cut: select 4 chars, Ctrl+X removes and copies them.
  t.clickAt(1, 150, 200);
  const p = t.state().caret.path;
  const off = t.state().caret.off;
  const full = t.textAt(p);
  for (let i = 0; i < 4; i++) press("ArrowRight", { shiftKey: true });
  const expect = [...full].slice(off, off + 4).join("");
  press("x", { ctrlKey: true });
  check("text removed", t.textAt(p) === [...full].slice(0, off).join("") + [...full].slice(off + 4).join(""));
  check("copied to buffer", t.cut === undefined ? true : true); // buffer read below
  const buf1 = t.copy(); // copy of empty sel returns lastCopied unchanged
  res.info.buf1 = buf1;
  check("cut captured the text", buf1 === expect);
  check("caret collapsed at cut point", t.state().caret && t.state().caret.off === off);
  t.undo();
  check("one undo restores", t.textAt(p) === full);

  // 2. Cross-paragraph cut via the hook: d/4 tail + d/5 head.
  const t4 = t.textAt("d/4"), t5 = t.textAt("d/5");
  const hit = (pp) => { for (let pi = 1; pi <= 2; pi++) for (const h of t.hits(pi)) if (h.path === pp && h.start !== null) return { h, page: pi }; return null; };
  const a = hit("d/4"), b = hit("d/5");
  t.select(a.page, a.h.x + a.h.adv[0] + 0.1, a.h.y - 1, b.h.x + b.h.adv[0] + 0.1, b.h.y - 1);
  const cutTxt = t.cut();
  res.info.cutTxt = cutTxt;
  check("cross-cut buffer has both sides", cutTxt.includes("\n"));
  check("paragraphs merged", t.textAt("d/4") === [...t4].slice(0, 1).join("") + [...t5].slice(1).join(""));
  t.undo();
  check("undo restores both", t.textAt("d/4") === t4 && t.textAt("d/5") === t5);

  // 3. Cut then paste round-trips the text (cut buffer -> paste).
  t.clickAt(1, 150, 200);
  for (let i = 0; i < 3; i++) press("ArrowRight", { shiftKey: true });
  const moved = t.selText();
  t.cut();
  press("End");
  const endOff = t.state().caret.off;
  t.paste(moved);
  check("cut+paste moves text", t.textAt(p) === [...full].slice(0, off).join("") + [...full].slice(off + 3).join("") + moved);
  t.undo(); t.undo();
  check("two undos restore", t.textAt(p) === full);

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

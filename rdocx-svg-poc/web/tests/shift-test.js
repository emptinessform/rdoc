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

  // 1. Shift+Right x5 selects five chars forward of the caret
  t.clickAt(1, 150, 200);
  const p = t.state().caret.path;
  const off = t.state().caret.off;
  const full = t.textAt(p);
  for (let i = 0; i < 5; i++) press("ArrowRight", { shiftKey: true });
  const s5 = t.selText();
  res.info.s5 = s5;
  check("five chars selected", s5 === [...full].slice(off, off + 5).join(""));

  // 2. Shift+Left x2 shrinks to three
  press("ArrowLeft", { shiftKey: true });
  press("ArrowLeft", { shiftKey: true });
  const s3 = t.selText();
  check("shrunk to three", s3 === [...full].slice(off, off + 3).join(""));

  // 3. shrink all the way back -> selection collapses to a caret
  press("ArrowLeft", { shiftKey: true });
  press("ArrowLeft", { shiftKey: true });
  press("ArrowLeft", { shiftKey: true });
  check("collapsed to caret", !!t.state().caret && t.state().caret.off === off && t.selText() === "");

  // 4. Shift+Down extends across a line (longer than a few chars)
  for (let i = 0; i < 2; i++) press("ArrowRight", { shiftKey: true });
  press("ArrowDown", { shiftKey: true });
  const sDown = t.selText();
  res.info.downLen = (sDown || "").length;
  check("line extension grows", (sDown || "").length > 5);

  // 5. plain ArrowLeft collapses to the selection start
  press("ArrowLeft");
  const c5 = t.state().caret;
  check("collapse to start", !!c5 && c5.path === p && c5.off === off && t.selText() === "");

  // 6. type over a shift-selection replaces it in one undo
  const snap = t.paraTexts().join("");
  for (let i = 0; i < 4; i++) press("ArrowRight", { shiftKey: true });
  press("X");
  check("typed over selection", t.paraTexts().join("") !== snap);
  t.undo();
  check("one undo restores", t.paraTexts().join("") === snap);

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

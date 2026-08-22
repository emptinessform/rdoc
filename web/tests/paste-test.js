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

  // 1. Single-line paste at the caret.
  t.clickAt(1, 150, 200);
  const p = t.state().caret.path;
  const off = t.state().caret.off;
  const full = t.textAt(p);
  t.paste("[붙임]");
  check("single-line inserted",
        t.textAt(p) === [...full].slice(0, off).join("") + "[붙임]" + [...full].slice(off).join(""));
  check("caret after paste", t.state().caret.off === off + 4);
  t.undo();
  check("one undo removes it", t.textAt(p) === full);

  // 2. Multi-line paste: 3 lines -> 2 new sibling paragraphs, one undo.
  const next = t.textAt(siblingOf(p, 1));
  t.clickAt(1, 150, 200);
  const off2 = t.state().caret.off;
  t.paste("하나\n둘\n셋");
  const head = [...full].slice(0, off2).join("") + "하나";
  const tail = "셋" + [...full].slice(off2).join("");
  res.info.multi = { p0: t.textAt(p), p1: t.textAt(siblingOf(p, 1)), p2: t.textAt(siblingOf(p, 2)) };
  check("head paragraph", t.textAt(p) === head);
  check("middle paragraph", t.textAt(siblingOf(p, 1)) === "둘");
  check("tail paragraph", t.textAt(siblingOf(p, 2)) === tail);
  const c2 = t.state().caret;
  check("caret at end of last line", c2.path === siblingOf(p, 2) && c2.off === 1);
  t.undo();
  check("single undo restores structure", t.textAt(p) === full && t.textAt(siblingOf(p, 1)) === next);

  // 3. Paste over a single-line selection = atomic replace (one undo).
  t.clickAt(1, 150, 200);
  for (let i = 0; i < 3; i++) press("ArrowRight", { shiftKey: true });
  const selTxt = t.selText();
  t.paste("교체");
  check("selection replaced", t.textAt(p) !== full && t.textAt(p).includes("교체"));
  t.undo();
  check("one undo restores replace", t.textAt(p) === full);

  // 4. Multi-line paste into a footnote (note story split path).
  let fnHit = null, fnPage = 0;
  for (let pi = 1; pi <= document.querySelectorAll("#pages svg").length; pi++)
    for (const h of t.hits(pi))
      if (h.path && h.path.startsWith("fn/")) { fnHit = h; fnPage = pi; }
  t.clickAt(fnPage, fnHit.x + 2, fnHit.y - 2);
  const fnPath = t.state().caret.path;
  const fnText = t.textAt(fnPath);
  t.paste("가\n나");
  check("footnote split by paste", t.textAt(siblingOf(fnPath, 1)) != null);
  t.undo();
  check("footnote restored", t.textAt(fnPath) === fnText && t.textAt(siblingOf(fnPath, 1)) == null);

  function siblingOf(path, n) {
    return path.replace(/\d+$/, (m) => +m + n);
  }
  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

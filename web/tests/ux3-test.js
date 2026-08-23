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

  // 1. Shift+End selects to line end; Shift+Home flips to line start
  t.clickAt(1, 150, 200);
  const p = t.state().caret.path;
  const off = t.state().caret.off;
  const full = t.textAt(p);
  press("End", { shiftKey: true });
  const toEnd = t.selText();
  res.info.toEnd = toEnd;
  check("shift+end selects tail", toEnd === [...full].slice(off).join(""));
  press("Home", { shiftKey: true });
  const toHome = t.selText();
  check("shift+home flips to head", toHome === [...full].slice(0, off).join(""));

  // 2. Delete at paragraph end pulls the next paragraph up (forward merge)
  t.clickAt(1, 150, 200);
  press("End");
  const endOff = t.state().caret.off;
  const nextPath = p.replace(/\d+$/, m => +m + 1);
  const nextText = t.textAt(nextPath);
  res.info.next = { nextPath, nextText: (nextText || "").slice(0, 20) };
  if (endOff === [...full].length && nextText != null) {
    press("Delete");
    check("forward merge joined", t.textAt(p) === full + nextText);
    check("caret stayed", t.state().caret.path === p && t.state().caret.off === endOff);
    t.undo();
    check("undo restores both", t.textAt(p) === full && t.textAt(nextPath) === nextText);
  } else {
    res.info.skipMerge = "next sibling is not a paragraph or line-wrapped end";
  }

  // 3. Shift+click extends from the caret to the clicked point. The
  // target is derived from the paragraph's own hit geometry (center of
  // its last text segment) so the test does not depend on which Korean
  // font shaped the demo (metrics differ between malgun and the open set).
  t.clickAt(1, 150, 200);
  const svg = document.querySelector("#pages svg");
  const r = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  const segs = t.hits(1).filter(h => h.path === p && h.start !== null)
    .sort((a, b) => a.start - b.start);
  const hEnd = segs[segs.length - 1];
  const targetX = hEnd.x + hEnd.adv.reduce((a, b) => a + b, 0) / 2;
  const cx = r.left + (targetX / vb.width) * r.width;
  const cy = r.top + ((hEnd.y - 2) / vb.height) * r.height;
  svg.dispatchEvent(new MouseEvent("mousedown", { clientX: cx, clientY: cy, bubbles: true, shiftKey: true }));
  window.dispatchEvent(new MouseEvent("mouseup", { clientX: cx, clientY: cy, bubbles: true, shiftKey: true }));
  const shiftSel = t.selText();
  res.info.shiftSel = shiftSel;
  check("shift+click selected a range", !!shiftSel && shiftSel.length >= 3);
  check("selection is a prefix-run of the paragraph", full.includes(shiftSel));

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

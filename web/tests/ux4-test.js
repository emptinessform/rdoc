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
  const svgs = () => document.querySelectorAll("#pages svg");
  const clientFor = (page, x, y) => {
    const svg = svgs()[page - 1];
    const r = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    return { svg, cx: r.left + (x / vb.width) * r.width, cy: r.top + (y / vb.height) * r.height };
  };
  const hitFor = (path) => {
    for (let pi = 1; pi <= svgs().length; pi++)
      for (const h of t.hits(pi))
        if (h.path === path && h.start !== null) return { h, page: pi };
    return null;
  };

  // 1. Triple-click selects the whole paragraph.
  const hp = hitFor("d/3"); // 한글 조판 테스트 문단 (multi-line)
  const full = t.textAt("d/3");
  const { svg, cx, cy } = clientFor(hp.page, hp.h.x + 3, hp.h.y - 2);
  for (const detail of [1, 2, 3]) {
    svg.dispatchEvent(new MouseEvent("mousedown", { clientX: cx, clientY: cy, bubbles: true, detail }));
    window.dispatchEvent(new MouseEvent("mouseup", { clientX: cx, clientY: cy, bubbles: true, detail }));
    if (detail === 2) svg.dispatchEvent(new MouseEvent("dblclick", { clientX: cx, clientY: cy, bubbles: true, detail }));
  }
  const triSel = t.selText();
  res.info.triLen = (triSel || "").length;
  check("triple-click selects the paragraph", triSel === full);
  check("caret cleared", t.state().caret === null);

  // 2. ArrowDown from the last body line of page 1 must NOT land in a
  //    header/footnote — with only notes below/next, the caret stays put.
  const hend = hitFor("d/11"); // — end of PoC page — (last body line, page 1)
  t.clickAt(hend.page, hend.h.x + 2, hend.h.y - 2);
  const before = t.state().caret;
  press("ArrowDown");
  const after = t.state().caret;
  res.info.arrow = { before, after };
  check("down from last body line stays in body story",
        after && (after.path.startsWith("d/") || (after.path === before.path && after.off === before.off)));

  // ArrowUp from the endnote (page 2, top content) must not jump into the
  // page-1 footer or footnote: endnote is the only en/ story line, so the
  // caret must stay in en/.
  const hen = hitFor("en/2/0");
  t.clickAt(hen.page, hen.h.x + 2, hen.h.y - 2);
  press("ArrowUp");
  const afterUp = t.state().caret;
  res.info.up = afterUp;
  check("up from endnote stays in en story", afterUp && afterUp.path.startsWith("en/"));

  // 3. Drag auto-scroll: shrink the viewport is not possible from JS, so
  //    simulate: start a drag in the body, move the pointer to the bottom
  //    edge of the viewport, and verify the page scrolls down over time.
  window.scrollTo(0, 0);
  await new Promise(r => setTimeout(r, 100));
  const h0 = hitFor("d/1");
  const c0 = clientFor(h0.page, h0.h.x + 2, h0.h.y - 2);
  c0.svg.dispatchEvent(new MouseEvent("mousedown", { clientX: c0.cx, clientY: c0.cy, bubbles: true, detail: 1 }));
  // move to bottom edge (stay inside the svg horizontally)
  const edgeY = window.innerHeight - 5;
  c0.svg.dispatchEvent(new MouseEvent("mousemove", { clientX: c0.cx + 40, clientY: c0.cy + 10, bubbles: true }));
  c0.svg.dispatchEvent(new MouseEvent("mousemove", { clientX: c0.cx + 40, clientY: edgeY, bubbles: true }));
  const y0 = window.scrollY;
  await new Promise(r => setTimeout(r, 600));
  const y1 = window.scrollY;
  window.dispatchEvent(new MouseEvent("mouseup", { clientX: c0.cx + 40, clientY: edgeY, bubbles: true }));
  res.info.scroll = { y0, y1 };
  check("drag near bottom edge auto-scrolls", y1 > y0 + 10);
  check("selection grew during scroll", (t.selText() || "").length > 0);

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

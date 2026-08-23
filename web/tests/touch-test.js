window.__benchResult = "pending";
(async () => {
  for (let i = 0; i < 120 && !window.__t; i++) await new Promise(r => setTimeout(r, 500));
  const t = window.__t;
  if (!t) { window.__benchResult = JSON.stringify({ error: "__t never appeared" }); return; }
  document.getElementById("demo").click();
  await new Promise(r => setTimeout(r, 1500));
  const res = { ok: true, fails: [], info: {} };
  const check = (name, cond) => { if (!cond) { res.ok = false; res.fails.push(name); } };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  const pages = document.getElementById("pages");
  const svg = document.querySelector("#pages svg");
  const r = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  const clientOf = (x, y) => ({
    cx: r.left + (x / vb.width) * r.width,
    cy: r.top + (y / vb.height) * r.height,
  });
  const fireTouch = (type, cx, cy) => {
    const touchInit = { identifier: 1, target: svg, clientX: cx, clientY: cy };
    const ev = new TouchEvent(type, {
      bubbles: true, cancelable: true,
      touches: type === "touchend" ? [] : [new Touch(touchInit)],
      changedTouches: [new Touch(touchInit)],
    });
    svg.dispatchEvent(ev);
  };

  // Anchor on the word "문장에는" area of d/4 (x of offset 2).
  const h = t.hits(1).find(x => x.path === "d/4" && x.start !== null && 2 >= x.start && 2 < x.start + x.adv.length);
  let x2 = h.x; for (let k = 0; k < 2 - h.start; k++) x2 += h.adv[k];
  const p0 = clientOf(x2 + 0.5, h.y - 2);

  // 1. Long press selects the word under the finger.
  fireTouch("touchstart", p0.cx, p0.cy);
  await wait(650);
  const sel1 = t.selText();
  res.info.longPress = sel1;
  check("long press selects a word", !!sel1 && sel1.length >= 1 && !sel1.includes(" "));

  // 2. Dragging after the long press extends the selection.
  const hFar = t.hits(1).filter(x => x.path === "d/4" && x.start !== null).sort((a, b) => b.start - a.start)[0];
  const p1 = clientOf(hFar.x + 2, hFar.y - 2);
  fireTouch("touchmove", p1.cx, p1.cy);
  await wait(100);
  const sel2 = t.selText();
  res.info.extended = sel2;
  check("touch drag extends selection", sel2.length > sel1.length);
  fireTouch("touchend", p1.cx, p1.cy);

  // 3. A quick move before the long press cancels (scroll wins).
  t.clickAt(1, h.x + 1, h.y - 2); // clear selection state
  fireTouch("touchstart", p0.cx, p0.cy);
  await wait(80);
  fireTouch("touchmove", p0.cx + 40, p0.cy + 40);
  await wait(650);
  const selAfterScroll = t.selText();
  res.info.afterScroll = selAfterScroll;
  check("quick move stays a scroll (no selection)", selAfterScroll === "");
  fireTouch("touchend", p0.cx + 40, p0.cy + 40);

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

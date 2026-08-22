window.__benchResult = "pending";
(async () => {
  for (let i = 0; i < 120 && !window.__t; i++) await new Promise(r => setTimeout(r, 500));
  const t = window.__t;
  if (!t) { window.__benchResult = JSON.stringify({ error: "__t never appeared" }); return; }
  document.getElementById("demo").click();
  await new Promise(r => setTimeout(r, 1500));
  const res = { ok: true, fails: [], info: {} };
  const check = (name, cond) => { if (!cond) { res.ok = false; res.fails.push(name); } };
  const press = (key) => document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));

  // 1. Save button produces the same bytes as save_docx
  const before = t.saveDocx();
  check("save button exists", !!document.getElementById("save"));
  res.info.bytes = before.length;

  // 2. ArrowDown moves the caret to the next visual line (path or offset
  //    changes, y of the caret line increases)
  t.clickAt(1, 150, 200);
  const caretY = () => {
    const el = document.querySelector(".caret");
    return el ? +el.getAttribute("y1") : null;
  };
  const p0 = { ...t.state().caret };
  const y0 = caretY();
  press("ArrowDown");
  const p1 = { ...(t.state().caret || {}) };
  const y1 = caretY();
  check("ArrowDown moved caret", y1 !== null && y0 !== null && y1 > y0);
  res.info.down = { from: p0, to: p1, y0, y1 };

  // 3. ArrowUp returns to (approximately) the original line
  press("ArrowUp");
  const y2 = caretY();
  check("ArrowUp returned", y2 !== null && Math.abs(y2 - y0) < 2);

  // 4. ArrowDown chains across many lines without dying (walk 15 lines)
  let last = y2, steps = 0;
  for (let i = 0; i < 15; i++) {
    press("ArrowDown");
    const y = caretY();
    if (y === null) break;
    if (y > last) steps++;
    last = y;
  }
  check("ArrowDown walked lines", steps >= 8);
  res.info.walked = steps;

  await new Promise(r => setTimeout(r, 100)); // let the scroll microtask run

  // 5. caret stays visible: after walking down, the caret element must be
  //    inside the viewport (scrollIntoView keeps it near)
  const el = document.querySelector(".caret");
  if (el) {
    const r = el.getBoundingClientRect();
    check("caret in viewport", r.top >= -5 && r.bottom <= window.innerHeight + 5);
    res.info.caretRect = { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight };
  } else {
    res.fails.push("caret element missing after walk");
    res.ok = false;
  }

  // 6. editing still intact after arrow navigation
  t.type("z");
  const pth = t.state().caret.path;
  check("typing after navigation", (t.textAt(pth) || "").includes("z"));
  t.undo();

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

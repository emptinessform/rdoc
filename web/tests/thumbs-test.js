window.__benchResult = "pending";
(async () => {
  for (let i = 0; i < 120 && !window.__t; i++) await new Promise(r => setTimeout(r, 500));
  const t = window.__t;
  if (!t) { window.__benchResult = JSON.stringify({ error: "__t never appeared" }); return; }
  document.getElementById("demo").click();
  await new Promise(r => setTimeout(r, 1500));
  const res = { ok: true, fails: [], info: {} };
  const check = (name, cond) => { if (!cond) { res.ok = false; res.fails.push(name); } };

  // 1. Toggle opens the sidebar and builds one thumb per page.
  t.toggleThumbs();
  let st = t.thumbs();
  check("opens", st.open);
  check("one cell per page", st.count === document.querySelectorAll("#pages svg").length);
  for (let i = 0; i < 40 && t.thumbs().pending > 0; i++) await new Promise(r => setTimeout(r, 100));
  st = t.thumbs();
  res.info.afterOpen = st;
  check("all thumbs rendered", st.pending === 0 && st.withSrc === st.count);

  // 2. An edit refreshes only that page's thumb (pending grows then drains).
  t.clickAt(1, 150, 200);
  t.type("x");
  await new Promise(r => setTimeout(r, 100));
  for (let i = 0; i < 40 && t.thumbs().pending > 0; i++) await new Promise(r => setTimeout(r, 100));
  check("edit refresh drains", t.thumbs().pending === 0);
  t.undo();

  // 3. A structural edit that adds a page grows the sidebar.
  const pagesBefore = t.thumbs().count;
  t.clickAt(1, 150, 200);
  for (let i = 0; i < 30; i++) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await new Promise(r => setTimeout(r, 300));
  const grew = document.querySelectorAll("#pages svg").length;
  for (let i = 0; i < 40 && t.thumbs().pending > 0; i++) await new Promise(r => setTimeout(r, 100));
  res.info.grow = { before: pagesBefore, after: t.thumbs().count, pages: grew };
  check("sidebar follows page count", t.thumbs().count === grew);
  for (let i = 0; i < 30; i++) t.undo();
  await new Promise(r => setTimeout(r, 300));
  for (let i = 0; i < 40 && t.thumbs().pending > 0; i++) await new Promise(r => setTimeout(r, 100));
  check("sidebar shrinks back", t.thumbs().count === document.querySelectorAll("#pages svg").length);

  // 4. Clicking a thumb scrolls to that page.
  document.getElementById("main").scrollTo(0, 0);
  const n = t.thumbs().count;
  document.querySelectorAll("#thumbs img")[n - 1].click();
  await new Promise(r => setTimeout(r, 200));
  check("thumb click scrolls", document.getElementById("main").scrollTop > 100);

  // 5. Close hides the sidebar.
  t.toggleThumbs();
  check("closes", !t.thumbs().open);

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

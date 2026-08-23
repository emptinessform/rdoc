window.__benchResult = "pending";
(async () => {
  for (let i = 0; i < 120 && !window.__t; i++) await new Promise(r => setTimeout(r, 500));
  const t = window.__t;
  if (!t) { window.__benchResult = JSON.stringify({ error: "__t never appeared" }); return; }
  const res = { ok: true, fails: [], info: {} };
  const check = (name, cond) => { if (!cond) { res.ok = false; res.fails.push(name); } };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  // comment-test.docx: "Hello [target]{comment} world".
  await t.loadUrl("./comment-test.docx?v=" + Date.now());
  await wait(600);

  // 1. List and spans are readable.
  const list = t.commentList();
  const spans = t.commentSpans();
  res.info.list = list;
  res.info.spans = spans;
  check("one comment listed", list.length === 1 && list[0].author === "rdoc tester"
    && list[0].text.includes("This is a comment"));
  check("span covers 'target'", spans.length === 1 && spans[0].path === "d/0"
    && spans[0].start === 6 && spans[0].end === 12);

  // 2. Toggling on draws highlight rects over the anchored range.
  t.toggleComments(true);
  await wait(300);
  const rects = [...document.querySelectorAll(".commenthl")];
  res.info.hl = rects.length;
  check("highlight rendered", rects.length >= 1);
  const hit = t.hits(1).find(h => h.path === "d/0" && h.start !== null && 6 >= h.start && 6 < h.start + h.adv.length);
  let x6 = hit.x; for (let k = 0; k < 6 - hit.start; k++) x6 += hit.adv[k];
  const covers = rects.some(r => +r.getAttribute("x") <= x6 + 1 &&
    +r.getAttribute("x") + +r.getAttribute("width") >= x6 + 1);
  check("highlight covers the anchor start", covers);

  // 3. Caret inside the range surfaces the comment in the status line.
  t.clickAt(1, x6 + 2, hit.y - 2);
  const status = document.getElementById("status").textContent;
  res.info.status = status;
  check("status shows the comment", status.includes("rdoc tester") && status.includes("This is a comment"));

  // 4. Caret outside shows the normal status.
  const h0 = t.hits(1).find(h => h.path === "d/0" && h.start === 0);
  t.clickAt(1, h0.x + 1, h0.y - 2);
  check("status normal outside", !document.getElementById("status").textContent.includes("This is a comment"));

  // 5. Editing before the anchor shifts the span (offsets re-read live).
  t.clickAt(1, h0.x + 1, h0.y - 2);
  t.type("X");
  await wait(300);
  const spans2 = t.commentSpans();
  res.info.spans2 = spans2;
  check("span shifts with edits", spans2.length === 1 && spans2[0].start === 7 && spans2[0].end === 13);
  t.undo();
  await wait(300);

  // 6. Toggle off removes the overlay.
  t.toggleComments(false);
  await wait(200);
  check("toggle off clears highlights", document.querySelectorAll(".commenthl").length === 0);

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

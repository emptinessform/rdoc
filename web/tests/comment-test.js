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

  // 7. Authoring: add a comment over "world" (13..18), then resolve and
  // remove it.
  const wOff = 13;
  const hw = t.hits(1).find(h => h.path === "d/0" && h.start !== null
    && wOff >= h.start && wOff < h.start + h.adv.length);
  let xw = hw.x; for (let k = 0; k < wOff - hw.start; k++) xw += hw.adv[k];
  const hw2 = t.hits(1).find(h => h.path === "d/0" && h.start !== null
    && 17 >= h.start && 17 < h.start + h.adv.length);
  let xw2 = hw2.x; for (let k = 0; k < 17 - hw2.start; k++) xw2 += hw2.adv[k];
  t.select(1, xw + 0.1, hw.y - 2, xw2 + hw2.adv[17 - hw2.start] - 0.1, hw2.y - 2);
  t.addComment("second note");
  await wait(400);
  const list2 = t.commentList();
  const spans3 = t.commentSpans();
  res.info.afterAdd = { list2, spans3 };
  check("comment added", list2.length === 2 && list2.some(c => c.text.includes("second note")));
  check("new span covers world", spans3.some(sp => sp.start === 13 && sp.end === 18));

  // Save round-trip keeps the authored comment.
  const bytes = t.saveDocx();
  await t.loadBytes(bytes);
  await wait(600);
  check("round-trip keeps authored comment",
    t.commentList().length === 2 && t.commentSpans().some(sp => sp.start === 13 && sp.end === 18));

  // Resolve toggle, then removal.
  const hw3 = t.hits(1).find(h => h.path === "d/0" && h.start !== null
    && 14 >= h.start && 14 < h.start + h.adv.length);
  let xw3 = hw3.x; for (let k = 0; k < 14 - hw3.start; k++) xw3 += hw3.adv[k];
  t.clickAt(1, xw3 + 0.5, hw3.y - 2);
  t.resolveComment();
  await wait(300);
  const newId = t.commentSpans().find(sp => sp.start === 13).id;
  check("resolved flag set", t.commentList().find(c => c.id === newId).resolved === true);
  t.clickAt(1, xw3 + 0.5, hw3.y - 2);
  t.removeComment();
  await wait(300);
  check("comment removed", t.commentList().length === 1
    && !t.commentSpans().some(sp => sp.start === 13));
  t.undo();
  await wait(300);
  check("undo restores comment", t.commentList().length === 2);

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

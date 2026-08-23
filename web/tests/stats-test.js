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

  // 1. Stats are consistent with the rendered document.
  const s0 = t.docStats();
  res.info.s0 = s0;
  check("pages match rendered", s0.pages === document.querySelectorAll("#pages svg").length);
  check("counts positive", s0.paragraphs > 0 && s0.words > 0 && s0.chars > s0.chars_no_space);

  // 2. Typing one new word raises word and char counts.
  const h = t.hits(1).find(x => x.path === "d/4" && x.start === 0);
  t.clickAt(1, h.x + 1, h.y - 2);
  t.type("added ");
  await wait(300);
  const s1 = t.docStats();
  res.info.s1 = s1;
  check("word count grows", s1.words === s0.words + 1);
  check("char count grows", s1.chars === s0.chars + 6);
  check("no-space count grows", s1.chars_no_space === s0.chars_no_space + 5);
  t.undo();
  await wait(300);
  check("undo restores counts", t.docStats().words === s0.words);

  // 3. The file menu action prints the stats to the status line.
  document.querySelector('#menubar [data-cmd="docStats"]').click();
  const status = document.getElementById("status").textContent;
  res.info.status = status;
  check("status shows stats", status.includes("페이지") && status.includes("단어"));

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

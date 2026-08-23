window.__benchResult = "pending";
(async () => {
  for (let i = 0; i < 120 && !window.__t; i++) await new Promise(r => setTimeout(r, 500));
  const t = window.__t;
  if (!t) { window.__benchResult = JSON.stringify({ error: "__t never appeared" }); return; }
  const res = { ok: true, fails: [], info: {} };
  const check = (name, cond) => { if (!cond) { res.ok = false; res.fails.push(name); } };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const pageText = () => t.hits(1).map(h => h.text).join("");

  // trackview-test.docx: "Hello " + ins("NEW ") + del("OLD ") + "world".
  await t.loadUrl("./trackview-test.docx?v=" + Date.now());
  await wait(600);

  // 1. Final (Accepted) view: insertion shown, deletion hidden.
  const txt0 = pageText();
  res.info.accepted = txt0;
  check("has revisions", t.hasRevisions() === true);
  check("final shows insertion", txt0.includes("NEW"));
  check("final hides deletion", !txt0.includes("OLD"));

  // 2. Tracked view renders both sides; the editor turns read-only.
  t.trackChanges(true);
  await wait(600);
  const txt1 = pageText();
  res.info.tracked = txt1;
  check("tracked shows deletion", txt1.includes("OLD") && txt1.includes("NEW"));
  const h = t.hits(1).find(x => x.path !== null && x.start !== null);
  t.clickAt(1, h.x + 1, h.y - 2);
  const before = pageText();
  t.type("X");
  await wait(200);
  check("editing is blocked", pageText() === before);

  // 3. Back to final view: deletion hidden again, editing works.
  t.trackChanges(false);
  await wait(600);
  check("final again hides deletion", !pageText().includes("OLD"));
  const h2 = t.hits(1).find(x => x.path === "d/0" && x.start === 0);
  t.clickAt(1, h2.x + 1, h2.y - 2);
  t.type("X");
  await wait(300);
  check("editing works after toggle-off", t.textAt("d/0").includes("X"));
  t.undo();

  // 4. The demo has no revisions.
  document.getElementById("demo").click();
  await wait(1200);
  check("demo reports no revisions", t.hasRevisions() === false);

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

window.__benchResult = "pending";
(async () => {
  for (let i = 0; i < 120 && !window.__t; i++) await new Promise(r => setTimeout(r, 500));
  const t = window.__t;
  if (!t) { window.__benchResult = JSON.stringify({ error: "__t never appeared" }); return; }
  await t.loadUrl("./bench.docx");
  const loadMs = t.state().lastMs;

  // pages are 1-based in findHit; nearest-hit search makes exact coords unnecessary
  t.clickAt(1, 150, 150);
  if (!t.state().caret) { window.__benchResult = JSON.stringify({ error: "no caret" }); return; }

  const typeMs = [];
  for (let i = 0; i < 3; i++) { t.type("a"); typeMs.push(t.state().lastMs); }
  const undoMs = [];
  for (let i = 0; i < 3; i++) { t.undo(); undoMs.push(t.state().lastMs); }
  const redoMs = [];
  for (let i = 0; i < 3; i++) { t.redo(); redoMs.push(t.state().lastMs); }

  window.__benchResult = JSON.stringify({ loadMs, typeMs, undoMs, redoMs, delta: t.state().lastDelta });
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

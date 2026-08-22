window.__benchResult = "pending";
(async () => {
  for (let i = 0; i < 120 && !window.__t; i++) await new Promise(r => setTimeout(r, 500));
  const t = window.__t;
  if (!t) { window.__benchResult = JSON.stringify({ error: "__t never appeared" }); return; }
  const res = { info: {} };

  // Load the 63-page bench document (with header + PAGE footer).
  const bytes = new Uint8Array(await (await fetch("bench.docx?v=2")).arrayBuffer());
  const t0 = performance.now();
  await t.loadBytes(bytes);
  res.info.loadMs = Math.round(performance.now() - t0);
  await new Promise(r => setTimeout(r, 300));

  // Caret mid-document: first hit on page 30.
  const h = t.hits(30).find(x => x.path && x.path.startsWith("d/") && x.start !== null);
  t.clickAt(30, h.x + 2, h.y - 2);
  if (!t.state().caret) { window.__benchResult = JSON.stringify({ error: "no caret" }); return; }

  // Typing: 10 keys, wasm-side ms per op (state().lastMs measures the conv
  // call: incremental relayout + delta SVG).
  const typing = [];
  for (let i = 0; i < 10; i++) {
    t.type("x");
    typing.push(t.state().lastMs);
    await new Promise(r => setTimeout(r, 30));
  }
  res.typing = {
    mean: Math.round(typing.reduce((a, b) => a + b) / typing.length),
    min: Math.round(Math.min(...typing)),
    max: Math.round(Math.max(...typing)),
  };

  // Structural ops (full-pass fallback): Enter, then Backspace merge.
  t.enter();
  res.enterMs = Math.round(t.state().lastMs);
  await new Promise(r => setTimeout(r, 50));
  t.backspace(); // caret at tail start -> merge
  res.mergeMs = Math.round(t.state().lastMs);

  // Undo latency (snapshot restore + relayout).
  await new Promise(r => setTimeout(r, 50));
  t.undo();
  res.undoMs = Math.round(t.state().lastMs);

  res.pages = document.querySelectorAll("#pages svg").length;
  res.delta = t.state().lastDelta;
  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

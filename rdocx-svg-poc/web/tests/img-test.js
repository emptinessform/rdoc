window.__benchResult = "pending";
(async () => {
  for (let i = 0; i < 120 && !window.__t; i++) await new Promise(r => setTimeout(r, 500));
  const t = window.__t;
  if (!t) { window.__benchResult = JSON.stringify({ error: "__t never appeared" }); return; }
  document.getElementById("demo").click();
  await new Promise(r => setTimeout(r, 1500));
  const res = { ok: true, fails: [], info: {} };
  const check = (name, cond) => { if (!cond) { res.ok = false; res.fails.push(name); } };
  const imgCount = () => document.querySelectorAll("#pages svg image").length;

  // A small red PNG from a canvas.
  const cv = document.createElement("canvas");
  cv.width = 40; cv.height = 20;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#e00";
  ctx.fillRect(0, 0, 40, 20);
  const blob = await new Promise((r) => cv.toBlob(r, "image/png"));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  res.info.pngBytes = bytes.length;

  // 1. Insert at the caret: an <image> appears, text unchanged.
  const base = imgCount();
  t.clickAt(1, 150, 200);
  const p = t.state().caret.path;
  const off = t.state().caret.off;
  const full = t.textAt(p);
  t.insertImage(bytes, "probe.png");
  await new Promise(r => setTimeout(r, 300));
  res.info.counts = { base, after: imgCount() };
  check("image rendered", imgCount() === base + 1);
  check("text unchanged", t.textAt(p) === full);
  check("caret kept", t.state().caret && t.state().caret.path === p && t.state().caret.off === off);

  // 2. One undo removes it.
  t.undo();
  await new Promise(r => setTimeout(r, 200));
  check("undo removes image", imgCount() === base);

  // 3. Insert + save round-trip keeps the image.
  t.clickAt(1, 150, 200);
  t.insertImage(bytes, "probe2.png");
  await new Promise(r => setTimeout(r, 200));
  const docx = t.saveDocx();
  await t.loadBytes(docx);
  await new Promise(r => setTimeout(r, 800));
  check("image survives save round-trip", imgCount() === base + 1);

  // 4. Refusal outside the body (caret in the footnote).
  let fnHit = null, fnPage = 0;
  for (let pi = 1; pi <= document.querySelectorAll("#pages svg").length; pi++)
    for (const h of t.hits(pi))
      if (h.path && h.path.startsWith("fn/")) { fnHit = h; fnPage = pi; }
  t.clickAt(fnPage, fnHit.x + 2, fnHit.y - 2);
  const cnt = imgCount();
  t.insertImage(bytes, "nope.png"); // errors via report; nothing changes
  await new Promise(r => setTimeout(r, 200));
  check("refused outside body", imgCount() === cnt);

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

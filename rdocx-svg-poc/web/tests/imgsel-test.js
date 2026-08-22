window.__benchResult = "pending";
(async () => {
  for (let i = 0; i < 120 && !window.__t; i++) await new Promise(r => setTimeout(r, 500));
  const t = window.__t;
  if (!t) { window.__benchResult = JSON.stringify({ error: "__t never appeared" }); return; }
  document.getElementById("demo").click();
  await new Promise(r => setTimeout(r, 1500));
  const res = { ok: true, fails: [], info: {} };
  const check = (name, cond) => { if (!cond) { res.ok = false; res.fails.push(name); } };
  const press = (key, init) => document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
  const imgs = () => document.querySelectorAll("#pages svg image");

  // Two images at distinct spots (d/3 and d/6 area via clicks).
  const cv = document.createElement("canvas");
  cv.width = 30; cv.height = 15;
  cv.getContext("2d").fillStyle = "#00e";
  cv.getContext("2d").fillRect(0, 0, 30, 15);
  const blob = await new Promise((r) => cv.toBlob(r, "image/png"));
  const bytes = new Uint8Array(await blob.arrayBuffer());

  t.clickAt(1, 150, 200);
  const p1 = t.state().caret.path;
  t.insertImage(bytes, "one.png");
  await new Promise(r => setTimeout(r, 200));
  t.clickAt(1, 150, 260);
  const p2 = t.state().caret.path;
  t.insertImage(bytes, "two.png");
  await new Promise(r => setTimeout(r, 200));
  res.info.paths = { p1, p2 };
  check("two images", imgs().length === 2);

  // 1. Real mouse click on the second image selects it (outline + state).
  const el = imgs()[1];
  const rc = el.getBoundingClientRect();
  el.dispatchEvent(new MouseEvent("mousedown", { clientX: rc.left + 3, clientY: rc.top + 3, bubbles: true }));
  check("click selects", t.imageSel() === 1);
  check("outline shown", imgs()[1].style.outline !== "");
  check("caret cleared", t.state().caret === null);

  // 2. Escape deselects; clicking text also deselects.
  press("Escape");
  check("esc deselects", t.imageSel() === null);
  t.selectImageAt(0);
  t.clickAt(1, 150, 200);
  check("text click deselects", t.imageSel() === null && t.state().caret !== null);

  // 3. Delete removes the selected (second) image; the first survives.
  t.selectImageAt(1);
  press("Delete");
  await new Promise(r => setTimeout(r, 200));
  check("one image left", imgs().length === 1);
  check("selection cleared after delete", t.imageSel() === null);
  t.undo();
  await new Promise(r => setTimeout(r, 200));
  check("undo restores", imgs().length === 2);

  // 4. Backspace works too, and two undos rewind both deletions.
  t.selectImageAt(0);
  press("Backspace");
  await new Promise(r => setTimeout(r, 200));
  check("backspace deletes", imgs().length === 1);
  t.undo();
  check("cleanup undo", imgs().length === 2);
  t.undo(); t.undo(); // the two insertions
  check("full rewind", imgs().length === 0);

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

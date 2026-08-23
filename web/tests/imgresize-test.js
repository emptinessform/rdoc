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
  const imgs = () => document.querySelectorAll("#pages svg image");

  // One 60x30 inline image.
  const cv = document.createElement("canvas");
  cv.width = 60; cv.height = 30;
  cv.getContext("2d").fillStyle = "#0a5";
  cv.getContext("2d").fillRect(0, 0, 60, 30);
  const blob = await new Promise((r) => cv.toBlob(r, "image/png"));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  t.clickAt(1, 150, 200);
  t.insertImage(bytes, "resize-me.png");
  await wait(300);
  check("image inserted", imgs().length === 1);
  const w0 = +imgs()[0].getAttribute("width");
  const h0 = +imgs()[0].getAttribute("height");
  res.info.initial = { w0, h0 };

  // 1. API resize: width 150pt, aspect kept, undo restores.
  t.resizeImage(0, 150);
  await wait(400);
  let w1 = +imgs()[0].getAttribute("width"), h1 = +imgs()[0].getAttribute("height");
  res.info.api = { w1, h1 };
  check("API resize sets width", Math.abs(w1 - 150) < 1);
  check("aspect ratio kept", Math.abs(h1 / w1 - h0 / w0) < 0.01);
  t.undo();
  await wait(400);
  check("undo restores width", Math.abs(+imgs()[0].getAttribute("width") - w0) < 1);

  // 2. Selecting the image shows the corner handle.
  let el = imgs()[0];
  let rc = el.getBoundingClientRect();
  el.dispatchEvent(new MouseEvent("mousedown", { clientX: rc.left + 3, clientY: rc.top + 3, bubbles: true }));
  await wait(100);
  check("image selected", t.imageSel() === 0);
  const handle = document.querySelector(".imghandle");
  check("corner handle appears", !!handle);

  // 3. Drag the handle +40pt: ghost shows, release commits, undo returns.
  if (handle) {
    const svg = el.ownerSVGElement;
    const r = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    const hx = +handle.getAttribute("x") + 4, hy = +handle.getAttribute("y") + 4;
    const cx = r.left + (hx / vb.width) * r.width;
    const cy = r.top + (hy / vb.height) * r.height;
    const dxPx = (40 / vb.width) * r.width;
    handle.dispatchEvent(new MouseEvent("mousedown", { clientX: cx, clientY: cy, bubbles: true }));
    check("drag ghost appears", document.querySelectorAll(".imgghost").length === 1);
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: cx + dxPx, clientY: cy, bubbles: true }));
    window.dispatchEvent(new MouseEvent("mouseup", { clientX: cx + dxPx, clientY: cy, bubbles: true }));
    await wait(500);
    const w2 = +imgs()[0].getAttribute("width");
    res.info.drag = { w2 };
    check("drag commits ~+40pt", Math.abs(w2 - w0 - 40) < 3);
    check("ghost removed", document.querySelectorAll(".imgghost").length === 0);
    t.undo();
    await wait(400);
  }

  // 4. Round-trip: a committed resize survives save/load.
  t.resizeImage(0, 120);
  await wait(300);
  const saved = t.saveDocx();
  await t.loadBytes(saved);
  await wait(600);
  check("round-trip keeps width", Math.abs(+imgs()[0].getAttribute("width") - 120) < 1);

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

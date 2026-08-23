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
  const dec = new TextDecoder("latin1");
  const pageObjects = (bytes) =>
    (dec.decode(bytes).match(/\/Type\s*\/Page[^s]/g) || []).length;

  // 1. The demo document exports a real PDF with one object per page.
  const pdf = t.savePdf();
  res.info.size = pdf.length;
  check("starts with %PDF-", dec.decode(pdf.slice(0, 5)) === "%PDF-");
  check("non-trivial size", pdf.length > 20000);
  const pages = t.state().total >= 0 ? document.querySelectorAll("#pages svg").length : 0;
  res.info.pages = { svg: pages, pdf: pageObjects(pdf) };
  check("page count matches the screen", pageObjects(pdf) === pages);
  check("fonts are embedded", dec.decode(pdf).includes("/FontFile2"));

  // 2. An edit shows up in a fresh export (no stale caching).
  const hit = t.hits(1).find(h => h.path && /^d\/\d+$/.test(h.path) && h.text.trim());
  t.clickAt(1, hit.x + 1, hit.y - 2);
  t.type("PDFCHECK");
  await wait(400);
  const pdf2 = t.savePdf();
  check("edited text reaches the PDF", dec.decode(pdf2).length > 0 && pdf2.length !== pdf.length);
  t.undo();
  await wait(300);

  // 3. Tracked view exports its own rendering.
  await new Promise((resolve) => {
    fetch("./trackview-test.docx").then(r => r.arrayBuffer()).then(async (b) => {
      await t.loadBytes(new Uint8Array(b));
      resolve();
    });
  });
  await wait(600);
  const accepted = t.savePdf();
  t.trackChanges(true);
  await wait(400);
  const tracked = t.savePdf();
  res.info.track = { accepted: accepted.length, tracked: tracked.length };
  check("tracked view PDF differs from accepted", tracked.length !== accepted.length);
  check("tracked PDF is valid", dec.decode(tracked.slice(0, 5)) === "%PDF-");
  t.trackChanges(false);

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

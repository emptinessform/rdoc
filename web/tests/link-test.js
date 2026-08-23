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
  const URL1 = "https://example.com/rdoc";

  // Group fill color of the hit covering (path, off).
  const fillAt = (path, off) => {
    for (const h of t.hits(1))
      if (h.path === path && h.start !== null && off >= h.start && off < h.start + h.adv.length) {
        const g = document.querySelectorAll("#pages svg")[0]
          .querySelector(`[data-hit="pg1-${h.id}"]`);
        return g && (g.getAttribute("fill") || "").toLowerCase();
      }
    return null;
  };

  // 1. Select chars 2..7 of d/3 and link them (via the bar's apply path).
  const p = "d/3";
  const segs = t.hits(1).filter(h => h.path === p && h.start !== null).sort((a, b) => a.start - b.start);
  const at = (off) => { // x of char offset
    for (const h of segs) if (off >= h.start && off < h.start + h.adv.length) {
      let x = h.x; for (let k = 0; k < off - h.start; k++) x += h.adv[k];
      return { x, y: h.y };
    }
    return null;
  };
  const a = at(2), b = at(7);
  t.select(1, a.x + 0.1, a.y - 2, b.x + 0.1, b.y - 2);
  t.openLink();
  t.setLink(URL1);
  await wait(400);
  check("linked url readable", t.linkAt(p, 3) === URL1);
  check("outside not linked", t.linkAt(p, 0) === null);
  const linkFill = fillAt(p, 3);
  res.info.linkFill = linkFill;
  check("link look applied", linkFill === "#0563c1" || linkFill === "rgb(5,99,193)");

  // 2. Ctrl+click follows the link (window.open stubbed).
  let opened = null;
  const realOpen = window.open;
  window.open = (u) => { opened = u; return null; };
  const svg = document.querySelector("#pages svg");
  const r = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  const pt = at(4);
  const cx = r.left + (pt.x / vb.width) * r.width;
  const cy = r.top + ((pt.y - 2) / vb.height) * r.height;
  svg.dispatchEvent(new MouseEvent("mousedown", { clientX: cx, clientY: cy, bubbles: true, ctrlKey: true }));
  window.dispatchEvent(new MouseEvent("mouseup", { clientX: cx, clientY: cy, bubbles: true, ctrlKey: true }));
  window.open = realOpen;
  res.info.opened = opened;
  check("ctrl+click opens the url", opened === URL1);

  // 3. Round-trip keeps the link.
  const bytes = t.saveDocx();
  await t.loadBytes(bytes);
  await wait(800);
  check("round-trip keeps link", t.linkAt(p, 3) === URL1);

  // 4. Remove: caret inside the link, then unlink clears url and look.
  const segs2 = t.hits(1).filter(h => h.path === p && h.start !== null).sort((x, y) => x.start - y.start);
  const h0 = segs2.find(h => 3 >= h.start && 3 < h.start + h.adv.length);
  let x = h0.x; for (let k = 0; k < 3 - h0.start; k++) x += h0.adv[k];
  t.clickAt(1, x + 0.5, h0.y - 2);
  t.removeLink();
  await wait(400);
  check("unlink clears url", t.linkAt(p, 3) === null);
  const plainFill = fillAt(p, 3);
  res.info.plainFill = plainFill;
  check("unlink clears look", plainFill !== "#0563c1" && plainFill !== "rgb(5,99,193)");
  t.undo();
  await wait(300);
  check("undo restores link", t.linkAt(p, 3) === URL1);

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

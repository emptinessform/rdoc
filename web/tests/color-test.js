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

  // Fill color of the glyph group covering a given paragraph offset: find
  // the hit, then its data-hit group on the page.
  const fillAt = (path, off) => {
    for (let pi = 1; pi <= document.querySelectorAll("#pages svg").length; pi++)
      for (const h of t.hits(pi))
        if (h.path === path && h.start !== null && off >= h.start && off < h.start + h.adv.length) {
          const g = document.querySelectorAll("#pages svg")[pi - 1]
            .querySelector(`[data-hit="pg${pi}-${h.id}"]`);
          return g && g.getAttribute("fill");
        }
    return null;
  };

  // 1. Color a 4-char range red; inside changes, outside stays.
  t.clickAt(1, 150, 200);
  const p = t.state().caret.path;
  const off = t.state().caret.off;
  const before = fillAt(p, off);
  for (let i = 0; i < 4; i++) press("ArrowRight", { shiftKey: true });
  t.fontColor("CC0000");
  await new Promise(r => setTimeout(r, 200));
  const inside = fillAt(p, off + 1);
  const outside = fillAt(p, off + 6);
  res.info = { before, inside, outside };
  check("inside is red", (inside || "").toLowerCase().replace(/\s/g, "").match(/^(#cc0000|rgb\(204,0,0\))$/) !== null);
  check("outside unchanged", outside === before);
  check("selection kept", t.selText().length === 4);

  // 2. One undo restores.
  t.undo();
  await new Promise(r => setTimeout(r, 200));
  check("undo restores color", fillAt(p, off + 1) === before);

  // 3. Color survives a save round-trip.
  t.clickAt(1, 150, 200);
  for (let i = 0; i < 3; i++) press("ArrowRight", { shiftKey: true });
  t.fontColor("008800");
  const bytes = t.saveDocx();
  await t.loadBytes(bytes);
  await new Promise(r => setTimeout(r, 800));
  const after = (fillAt(p, off + 1) || "").toLowerCase().replace(/\s/g, "");
  res.info.roundtrip = after;
  check("color survives round-trip", after === "#008800" || after === "rgb(0,136,0)");

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

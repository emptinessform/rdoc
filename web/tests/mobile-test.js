window.__benchResult = "pending";
(async () => {
  for (let i = 0; i < 120 && !window.__t; i++) await new Promise(r => setTimeout(r, 500));
  const t = window.__t;
  if (!t) { window.__benchResult = JSON.stringify({ error: "__t never appeared" }); return; }
  document.getElementById("demo").click();
  await new Promise(r => setTimeout(r, 1500));
  const res = { ok: true, fails: [], info: {} };
  const check = (name, cond) => { if (!cond) { res.ok = false; res.fails.push(name); } };

  // Static mobile-readiness guards (the battery runs at a desktop
  // viewport; real narrow-viewport behavior is verified per stage with
  // `browse viewport` sessions — see the S42 worklog).
  const meta = document.querySelector('meta[name="viewport"]');
  check("viewport meta present", !!meta && /width=device-width/.test(meta.content));

  const css = [...document.querySelectorAll("style")].map(s => s.textContent).join("");
  check("narrow-screen media query present", css.includes("@media (max-width: 640px)"));
  check("pages shrink on narrow screens", /max-width:\s*100%/.test(css));

  const ime = document.getElementById("ime");
  check("ime input mobile-safe", ime.getAttribute("autocapitalize") === "off"
    && ime.getAttribute("spellcheck") === "false");

  // Click accuracy under CSS downscale: shrink the page with an inline
  // max-width, click through client coordinates, then restore.
  const svg = document.querySelector("#pages svg");
  svg.style.maxWidth = "300px";
  await new Promise(r => setTimeout(r, 100));
  const h = t.hits(1).find(x => x.path === "d/4" && x.start === 0);
  const rct = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  const cx = rct.left + ((h.x + 1) / vb.width) * rct.width;
  const cy = rct.top + ((h.y - 2) / vb.height) * rct.height;
  svg.dispatchEvent(new MouseEvent("mousedown", { clientX: cx, clientY: cy, bubbles: true }));
  window.dispatchEvent(new MouseEvent("mouseup", { clientX: cx, clientY: cy, bubbles: true }));
  const caret = t.state().caret;
  res.info.caret = caret;
  check("click maps correctly when downscaled", caret && caret.path === "d/4" && caret.off <= 1);
  svg.style.maxWidth = "";

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

window.__benchResult = "pending";
(async () => {
  for (let i = 0; i < 120 && !window.__t; i++) await new Promise(r => setTimeout(r, 500));
  const t = window.__t;
  if (!t) { window.__benchResult = JSON.stringify({ error: "__t never appeared" }); return; }
  document.getElementById("demo").click();
  await new Promise(r => setTimeout(r, 1500));
  const res = { ok: true, fails: [], info: {} };
  const check = (name, cond) => { if (!cond) { res.ok = false; res.fails.push(name); } };

  // Click the caret onto a given character offset of a paragraph, using
  // the covering hit segment's geometry.
  const clickOff = (path, off) => {
    for (const h of t.hits(1)) {
      if (h.path !== path || h.start === null) continue;
      if (off >= h.start && off < h.start + h.adv.length) {
        let x = h.x;
        for (let k = 0; k < off - h.start; k++) x += h.adv[k];
        t.clickAt(1, x + Math.max(0.5, h.adv[off - h.start] / 2), h.y - 2);
        return true;
      }
    }
    return false;
  };
  const btnOn = (f) => document.querySelector(`#fmtbtns [data-fmt="${f}"]`).classList.contains("on");
  const state = () => ({
    b: btnOn("b"), i: btnOn("i"), u: btnOn("u"),
    size: document.getElementById("fontsize").value,
    family: document.getElementById("fontfamily").value,
  });

  // d/2: "Styled runs: bold, italic, red, strikethrough, large 16pt."
  const p = "d/2";
  const text = t.textAt(p);
  res.info.text = text;

  // 1. Caret in the bold word: B pressed, I not.
  check("clicked bold word", clickOff(p, [...text].join("").indexOf("bold") + 1));
  res.info.atBold = state();
  check("B on at bold", res.info.atBold.b === true);
  check("I off at bold", res.info.atBold.i === false);

  // 2. Caret in the italic word: I pressed, B not.
  clickOff(p, text.indexOf("italic") + 1);
  res.info.atItalic = state();
  check("I on at italic", res.info.atItalic.i === true);
  check("B off at italic", res.info.atItalic.b === false);

  // 3. Caret in the 16pt run: size field shows 16.
  clickOff(p, text.indexOf("16pt") + 1);
  res.info.at16 = state();
  check("size shows 16", res.info.at16.size === "16");

  // 4. Caret in plain text (paragraph start): nothing pressed.
  clickOff(p, 1);
  res.info.atPlain = state();
  check("nothing on in plain text", !res.info.atPlain.b && !res.info.atPlain.i && !res.info.atPlain.u);

  // 5. A selection spanning bold+plain: all-on rule keeps B unpressed;
  // selecting inside the bold word presses it.
  const press = (key, init) => document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
  clickOff(p, text.indexOf("bold") + 1);
  for (let i = 0; i < 2; i++) press("ArrowRight", { shiftKey: true });
  res.info.selInBold = state();
  check("B on for selection inside bold", res.info.selInBold.b === true);
  clickOff(p, text.indexOf("bold") - 2);
  for (let i = 0; i < 6; i++) press("ArrowRight", { shiftKey: true });
  res.info.selMixed = state();
  check("B off for mixed selection", res.info.selMixed.b === false);

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

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

  // 1. Delete (forward) removes the char AT the caret
  t.clickAt(1, 150, 200);
  const p = t.state().caret.path;
  const full = t.textAt(p);
  const off = t.state().caret.off;
  press("Delete");
  const after = t.textAt(p);
  check("forward delete", after === [...full].filter((_, i) => i !== off).join(""));
  check("caret offset held", t.state().caret.off === off);
  t.undo();

  // 2. Delete at paragraph end is a quiet no-op
  t.clickAt(1, 150, 200); // undo cleared the caret
  press("End");
  const endOff = t.state().caret.off;
  res.info.endOff = endOff;
  check("End jumped to line end", endOff > off);
  const snapshot = t.paraTexts().join("");
  if (endOff === [...full].length) {
    press("Delete");
    check("delete at end no-op", t.paraTexts().join("") === snapshot);
  } else {
    res.info.endNote = "line-end != paragraph-end (wrapped)";
  }

  // 3. Home returns to the line start
  press("Home");
  check("Home jumped to line start", t.state().caret.off < endOff);

  // 4. Ctrl+A selects everything (copyable)
  press("a", { ctrlKey: true });
  const copied = t.copy();
  res.info.copiedLen = (copied || "").length;
  check("select all copies plenty", (copied || "").length > 100);

  // 5. double-click selects a word
  const svg = document.querySelector("#pages svg");
  const r = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  const cx = r.left + (150 / vb.width) * r.width;
  const cy = r.top + (200 / vb.height) * r.height;
  svg.dispatchEvent(new MouseEvent("dblclick", { clientX: cx, clientY: cy, bubbles: true }));
  const word = t.selText();
  res.info.word = word;
  check("dblclick selected a word", !!word && word.length >= 1 && !/\s/.test(word));

  // 6. typing over the dblclick selection replaces it (one undo)
  if (word) {
    const beforeSnap = t.paraTexts().join("");
    t.replaceSel("W");
    check("word replaced", t.paraTexts().join("") !== beforeSnap);
    t.undo();
    check("one undo restores", t.paraTexts().join("") === beforeSnap);
  }

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

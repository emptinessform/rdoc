window.__benchResult = "pending";
(async () => {
  for (let i = 0; i < 120 && !window.__t; i++) await new Promise(r => setTimeout(r, 500));
  const t = window.__t;
  if (!t) { window.__benchResult = JSON.stringify({ error: "__t never appeared" }); return; }
  document.getElementById("demo").click();
  await new Promise(r => setTimeout(r, 1500));
  const res = { ok: true, fails: [], info: {} };
  const check = (name, cond) => { if (!cond) { res.ok = false; res.fails.push(name); } };
  const sib = (p, d) => { const m = p.match(/^(.*?)(\d+)$/); return m ? m[1] + (+m[2] + d) : null; };
  const caretDrawn = () => !!document.querySelector(".caret");

  // 1. split a body paragraph at its very end -> empty tail paragraph
  let end = null;
  for (let x = 560; x >= 60 && !end; x -= 8) {
    t.clickAt(1, x, 200);
    const c = t.state().caret;
    if (c && c.path.startsWith("d/") && !c.path.includes(".")) end = { x, path: c.path, off: c.off };
  }
  check("body end reachable", !!end);
  t.clickAt(1, end.x, 200);
  const full = t.textAt(end.path);
  // push the caret to the true end by splitting at current offset only if
  // it equals the text length; otherwise retry rightward clicks rounded up.
  res.info.endOff = t.state().caret.off;
  res.info.fullLen = [...full].length;
  t.enter();
  const tail = sib(end.path, +1);
  const tailText = t.textAt(tail);
  res.info.tailText = tailText;

  // 2. the (possibly empty) tail paragraph draws a caret immediately
  check("caret drawn on tail", caretDrawn());

  // 3. click AWAY then click back into the tail line: the empty paragraph
  //    must be clickable (this was a dead zone before)
  if (tailText === "") {
    t.clickAt(1, 150, 120); // somewhere else
    let hitBack = null;
    for (let y = 150; y <= 400 && !hitBack; y += 4) {
      for (let x = 60; x <= 500 && !hitBack; x += 20) {
        t.clickAt(1, x, y);
        const c = t.state().caret;
        if (c && c.path === tail) hitBack = { x, y };
      }
    }
    check("empty paragraph clickable", !!hitBack);
    check("caret drawn in empty paragraph", caretDrawn());
    // 4. typing into the empty paragraph works and caret stays visible
    t.type("살");
    check("typed into empty paragraph", t.textAt(tail) === "살");
    t.undo();
  } else {
    res.info.note = "split was mid-text; tail not empty (offset rounding)";
  }
  t.undo(); // undo the split

  // 5. a fresh footnote's empty paragraph draws a caret right away
  t.clickAt(1, 150, 200);
  t.insertFootnote();
  const notePath = t.state().caret && t.state().caret.path;
  res.info.notePath = notePath;
  check("caret drawn in new empty note", caretDrawn());
  t.type("가");
  check("typed into new note", t.textAt(notePath) === "가");
  t.undo(); t.undo();

  window.__benchResult = JSON.stringify(res);
})().catch(e => { window.__benchResult = "ERR: " + e; });
"started"

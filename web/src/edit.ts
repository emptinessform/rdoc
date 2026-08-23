// Editing core: the edit() transaction wrapper, selection-range
// normalization, and every text/structure mutation that goes through it.

import { S, chars, allHits, cmpPos, getRun, sameContainer, siblingPath } from "./state.js";
import type { Ref } from "./state.js";

export interface ParaRange { path: string; start: number; end: number }
export type SelRange =
  | { kind: "same" | "siblings"; pa: string; oa: number; pb: string; ob: number }
  | { kind: "scatter"; ranges: ParaRange[] };
import { apply, report } from "./render.js";
import { drawCaret, drawSelection, lineEdgeOff, lineTarget } from "./view.js";

/// Selection endpoints as an ordered document range, or null when either
/// endpoint has no provenance mapping.
export function selRange(): SelRange | null {
  if (!S.sel) return null;
  const A = getRun(S.sel.a), B = getRun(S.sel.b);
  if (!A || !B || A.path === null || B.path === null) return null;

  let pa = A.path, oa = (A.start ?? 0) + S.sel.a.k, pb = B.path, ob = (B.start ?? 0) + S.sel.b.k;
  if (pa === pb) {
    if (ob < oa) [oa, ob] = [ob, oa];
    return { kind: "same", pa, oa, pb, ob };
  }
  if (sameContainer(pa, pb)) {
    const idx = (p: string) => +p.match(/(\d+)$/)![1];
    if (idx(pb) < idx(pa)) [pa, oa, pb, ob] = [pb, ob, pa, oa];
    return { kind: "siblings", pa, oa, pb, ob };
  }
  // Scattered (e.g. across table cells): decompose the selection into one
  // covered range per touched Document-story paragraph, in document order.
  // Text is removed, cell/paragraph structure stays (Word-like clearing).
  const ranges: ParaRange[] = [];
  const byPath = new Map<string, ParaRange>();
  for (const h of allHits()) {
    if (h.path === null || h.start === null || !h.path.startsWith("d/")) continue;
    const cs = chars(h.text);
    const ref = { page: h.page, idx: h.id };
    if (cmpPos({ ...ref, k: cs.length }, S.sel.a) < 0 || cmpPos({ ...ref, k: 0 }, S.sel.b) > 0) continue;
    const k1 = h.page === S.sel.a.page && h.id === S.sel.a.idx ? S.sel.a.k : 0;
    const k2 = h.page === S.sel.b.page && h.id === S.sel.b.idx ? S.sel.b.k : cs.length;
    if (k2 <= k1) continue;
    let r = byPath.get(h.path);
    if (!r) { r = { path: h.path, start: h.start + k1, end: h.start + k2 }; byPath.set(h.path, r); ranges.push(r); }
    else { r.start = Math.min(r.start, h.start + k1); r.end = Math.max(r.end, h.start + k2); }
  }
  if (!ranges.length) return null;
  return { kind: "scatter", ranges };
}

// Any selection as per-paragraph {path, start, end} ranges.
export function selectionRanges(): ParaRange[] | null {
  const r = selRange();
  if (!r) return null;
  if (r.kind === "scatter") return r.ranges;
  if (r.kind === "same") return [{ path: r.pa, start: r.oa, end: r.ob }];
  const idx = (pp: string) => +pp.match(/(\d+)$/)![1];
  const out: ParaRange[] = [];
  for (let i = idx(r.pa); i <= idx(r.pb); i++) {
    const path = r.pa.replace(/\d+$/, String(i));
    const len = chars(S.conv.paragraph_text_at(path) || "").length;
    const start = i === idx(r.pa) ? r.oa : 0;
    const end = i === idx(r.pb) ? r.ob : len;
    if (end > start) out.push({ path, start, end });
  }
  return out;
}

export function edit(fn: () => string) {
  // Single choke point for every mutation (toolbar, menus, keyboard,
  // test hooks): the tracked-changes view is read-only.
  if (S.trackedView) {
    report("변경 내용 표시 중 — 편집하려면 보기에서 표시를 끄세요");
    return;
  }
  const t = performance.now();
  try {
    const json = fn();
    apply(json, performance.now() - t);
  } catch (err) {
    report(`error: ${err}`);
  }
}

export function typeText(s: string) {
  const c = S.caret;
  if (!c) return;
  edit(() => {
    const json = S.conv.insert(c.path, c.off, s);
    c.off += chars(s).length;
    return json;
  });
}

export function backspace() {
  const c = S.caret;
  if (!c || c.off === 0) return;
  edit(() => {
    const json = S.conv.delete(c.path, c.off);
    c.off -= 1;
    return json;
  });
}

export function deleteSel() {
  const r = selRange();
  if (!r) return;
  edit(() => {
    const json = r.kind === "scatter"
      ? S.conv.delete_ranges(JSON.stringify(r.ranges))
      : S.conv.delete_selection(r.pa, r.oa, r.pb, r.ob);
    S.caret = r.kind === "scatter"
      ? { path: r.ranges[0].path, off: r.ranges[0].start }
      : { path: r.pa, off: r.oa };
    S.sel = null;
    return json;
  });
}

export function replaceSelWith(s: string) {
  const r = selRange();
  if (!r) return;
  edit(() => {
    // One wasm call = one undo entry for the whole replacement.
    const json = r.kind === "scatter"
      ? S.conv.replace_ranges(JSON.stringify(r.ranges), s)
      : S.conv.replace_selection(r.pa, r.oa, r.pb, r.ob, s);
    const at = r.kind === "scatter"
      ? { path: r.ranges[0].path, off: r.ranges[0].start }
      : { path: r.pa, off: r.oa };
    S.caret = { path: at.path, off: at.off + chars(s).length };
    S.sel = null;
    return json;
  });
}

export function enterKey() {
  const c = S.caret;
  if (!c) return;
  edit(() => {
    const json = S.conv.split(c.path, c.off);
    S.caret = { path: siblingPath(c.path, +1)!, off: 0 };
    return json;
  });
}

export function mergePrev() {
  const c = S.caret;
  if (!c) return;
  const prevPath = siblingPath(c.path, -1);
  if (prevPath == null) return;
  const prevText = S.conv.paragraph_text_at(prevPath);
  if (prevText == null) return; // previous sibling is a table or missing
  const prevLen = chars(prevText).length;
  edit(() => {
    const json = S.conv.merge(c.path);
    S.caret = { path: prevPath, off: prevLen };
    return json;
  });
}

export function toggleFmt(f: string) {
  const ranges = selectionRanges();
  if (!ranges || !ranges.length) { report("select some text first (Ctrl+B/I/U)"); return; }
  edit(() => {
    const json = S.conv.toggle_ranges(JSON.stringify(ranges), f);
    S.sel = null;
    const last = ranges[ranges.length - 1];
    S.caret = { path: last.path, off: last.end };
    return json;
  });
}

export function insertFootnote() {
  const c = S.caret;
  if (!c || !c.path.startsWith("d/")) { report("각주는 본문에서만 삽입"); return; }
  edit(() => {
    const json = S.conv.insert_footnote(c.path, c.off);
    const id = S.conv.last_note_id();
    S.caret = id == null ? null : { path: `fn/${id}/0`, off: 0 };
    S.sel = null;
    return json;
  });
}

export function deleteFootnote() {
  const c = S.caret;
  if (!c || !c.path.startsWith("fn/")) { report("각주 안에 캐럿을 두고 Ctrl+Alt+D"); return; }
  edit(() => {
    const json = S.conv.delete_footnote(c.path);
    S.caret = null;
    S.sel = null;
    return json;
  });
}

export function insertEndnote() {
  const c = S.caret;
  if (!c || !c.path.startsWith("d/")) { report("미주는 본문에서만 삽입"); return; }
  edit(() => {
    const json = S.conv.insert_endnote(c.path, c.off);
    const id = S.conv.last_note_id();
    S.caret = id == null ? null : { path: `en/${id}/0`, off: 0 };
    S.sel = null;
    return json;
  });
}

export function deleteEndnote() {
  const c = S.caret;
  if (!c || !c.path.startsWith("en/")) { report("미주 안에 캐럿을 두고 Ctrl+Alt+D"); return; }
  edit(() => {
    const json = S.conv.delete_endnote(c.path);
    S.caret = null;
    S.sel = null;
    return json;
  });
}

// Ctrl+Alt+D deletes whichever note the caret sits in.
export function deleteNote() {
  if (S.caret && S.caret.path.startsWith("en/")) deleteEndnote();
  else deleteFootnote();
}

export function forwardDelete() {
  const c = S.caret;
  if (!c) return; // callers guard; keep the invariant explicit for types
  const len = chars(S.conv.paragraph_text_at(c.path) || "").length;
  if (c.off >= len) {
    // End of paragraph: pull the next sibling paragraph up (forward merge).
    const nextPath = siblingPath(c.path, +1);
    if (nextPath == null || S.conv.paragraph_text_at(nextPath) == null) return;
    const keep = { ...c };
    edit(() => {
      const json = S.conv.merge(nextPath);
      S.caret = keep; // the merge lands in our paragraph; offset unchanged
      return json;
    });
    return;
  }
  edit(() => {
    const json = S.conv.delete(c.path, c.off + 1);
    return json; // caret offset unchanged
  });
}

export function caretToLineEdge(end: boolean) {
  const c = S.caret;
  if (!c) return; // callers guard
  const off = lineEdgeOff(c, end);
  if (off !== null) { c.off = off; drawCaret(); report(); }
}

// Select from the first to the last hit run of the document (display and
// copy; range edits still require compatible endpoints).
export function selectAll() {
  let first: Ref | null = null, last: Ref | null = null;
  for (let pg = 0; pg < S.pageHits.length; pg++) {
    for (const h of S.pageHits[pg] || []) {
      if (h.adv.length === 0) continue;
      const ref = { page: h.page, idx: h.id };
      if (!first) first = { ...ref, k: 0 };
      last = { ...ref, k: h.adv.length };
    }
  }
  if (!first || !last) return;
  S.sel = { a: first, b: last };
  S.caret = null;
  drawCaret(); drawSelection(); report();
}

// Move the caret one visual line up or down: from its current on-page
// position, pick the nearest hit on the closest baseline in that
// direction (crossing to the neighboring page when needed).
export function moveCaretLine(dir: number) {
  if (!S.caret) return; // callers guard
  const target = lineTarget(S.caret, dir);
  if (!target) return;
  S.caret = target;
  S.sel = null;
  drawSelection();
  drawCaret();
  report();
}

export function doUndo() { edit(() => { const j = S.conv.undo(); S.caret = null; S.sel = null; return j; }); }
export function doRedo() { edit(() => { const j = S.conv.redo(); S.caret = null; S.sel = null; return j; }); }

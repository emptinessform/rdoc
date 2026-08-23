// Shared mutable editor state + pure helpers. Every module reads and
// writes through `S` so cross-module mutation stays explicit.

export const S = {
  conv: null,       // wasm SvgConverter, set once in main.js after init
  pageHits: [],     // pageHits[pageIndex] = [HitRun...] (ids page-local)
  caret: null,      // {path, off} in document coordinates
  sel: null,        // {a, b} where each is {page, idx, k}; a <= b
  lastMs: 0,
  lastDelta: "",
  zoom: 1,
  imageSel: null,   // { el, index } for a click-selected inline image
  lastCopied: "",
  selAnchor: null,  // keyboard selection: fixed anchor (document coords)
  selFocus: null,   //                    moving focus
  comp: null,       // in-flight IME composition {base, len}
};

export const chars = (s) => [...s];
export const width = (h) => h.adv.reduce((a, b) => a + b, 0);
export const cum = (h, k) => h.adv.slice(0, k).reduce((a, b) => a + b, 0);
export const allHits = () => S.pageHits.flat();
export const getRun = (ref) => (S.pageHits[ref.page - 1] || [])[ref.idx];
export const cmpPos = (p, q) => (p.page - q.page) || (p.idx - q.idx) || ((p.k ?? 0) - (q.k ?? 0));

export function orderSel(p, q) {
  return cmpPos(p, q) <= 0 ? { a: p, b: q } : { a: q, b: p };
}

// "d/8.1.0.0" -> "d/8.1.0.1", "h/rId1/0" -> "h/rId1/1": a split's tail is
// always the next sibling, so bump the final path segment.
export function siblingPath(path, delta) {
  const m = path.match(/^(.*?)(\d+)$/);
  if (!m) return null;
  const n = +m[2] + delta;
  return n < 0 ? null : m[1] + n;
}

// Sibling paragraphs = same path with only the final numeric segment
// differing (same body run, same cell, same header/footer, same note).
export function sameContainer(pa, pb) {
  const a = pa.match(/^(.*?)(\d+)$/), b = pb.match(/^(.*?)(\d+)$/);
  return !!(a && b && a[1] === b[1]);
}

// The story prefix ("d", "h", "f", "fn", "en") of a hit path, or null.
export function storyOf(path) {
  const m = path === null ? null : path.match(/^(d|h|f|fn|en)\//);
  return m ? m[1] : null;
}

// Shared mutable editor state + pure helpers. Every module reads and
// writes through `S` so cross-module mutation stays explicit.

import type { SvgConverter } from "../pkg/rdoc_core.js";

/** One positioned hit run from the wasm layout (ids are page-local). */
export interface HitRun {
  page: number;          // 1-based page number
  id: number;            // index within the page's hit list
  path: string | null;   // source path ("d/12", "fn/2/0"…); null = decorative
  start: number | null;  // char offset of the run's first char in its paragraph
  text: string;
  x: number;             // pt, SVG viewBox coords
  y: number;             // baseline
  size: number;          // font size, pt
  adv: number[];         // per-character advances, pt
}

/** A position in document coordinates. */
export interface Pos { path: string; off: number }
/** A position in hit coordinates (page + hit id + char index). */
export interface Ref { page: number; idx: number; k: number }
export interface Sel { a: Ref; b: Ref }
export interface Comp { base: number; len: number }
export interface ImageSel { el: SVGImageElement; index: number }

export interface State {
  /** wasm SvgConverter — assigned once in main.ts right after init(),
   *  before anything can call into it, hence typed non-null. */
  conv: SvgConverter;
  pageHits: HitRun[][];
  caret: Pos | null;
  sel: Sel | null;
  lastMs: number;
  lastDelta: string;
  zoom: number;
  imageSel: ImageSel | null;
  lastCopied: string;
  selAnchor: Pos | null;   // keyboard selection: fixed anchor
  selFocus: Pos | null;    //                     moving focus
  comp: Comp | null;       // in-flight IME composition
}

export const S: State = {
  conv: null as unknown as SvgConverter,
  pageHits: [],
  caret: null,
  sel: null,
  lastMs: 0,
  lastDelta: "",
  zoom: 1,
  imageSel: null,
  lastCopied: "",
  selAnchor: null,
  selFocus: null,
  comp: null,
};

export const chars = (s: string) => [...s];
export const width = (h: HitRun) => h.adv.reduce((a, b) => a + b, 0);
export const cum = (h: HitRun, k: number) => h.adv.slice(0, k).reduce((a, b) => a + b, 0);
export const allHits = () => S.pageHits.flat();
export const getRun = (ref: { page: number; idx: number }): HitRun | undefined =>
  (S.pageHits[ref.page - 1] || [])[ref.idx];
export const cmpPos = (p: { page: number; idx: number; k?: number }, q: Ref) =>
  (p.page - q.page) || (p.idx - q.idx) || ((p.k ?? 0) - q.k);

export function orderSel(p: Ref, q: Ref): Sel {
  return cmpPos(p, q) <= 0 ? { a: p, b: q } : { a: q, b: p };
}

// "d/8.1.0.0" -> "d/8.1.0.1", "h/rId1/0" -> "h/rId1/1": a split's tail is
// always the next sibling, so bump the final path segment.
export function siblingPath(path: string, delta: number): string | null {
  const m = path.match(/^(.*?)(\d+)$/);
  if (!m) return null;
  const n = +m[2] + delta;
  return n < 0 ? null : m[1] + n;
}

// Sibling paragraphs = same path with only the final numeric segment
// differing (same body run, same cell, same header/footer, same note).
export function sameContainer(pa: string, pb: string): boolean {
  const a = pa.match(/^(.*?)(\d+)$/), b = pb.match(/^(.*?)(\d+)$/);
  return !!(a && b && a[1] === b[1]);
}

// The story prefix ("d", "h", "f", "fn", "en") of a hit path, or null.
export function storyOf(path: string | null): string | null {
  const m = path === null ? null : path.match(/^(d|h|f|fn|en)\//);
  return m ? m[1] : null;
}

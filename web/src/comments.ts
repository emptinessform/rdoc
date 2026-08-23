// Comment display: anchor highlights (view-menu toggle) and a status
// line entry when the caret lands inside a commented range. Read-only —
// authoring comments is a later stage.

import { S, chars, allHits, cum } from "./state.js";
import { pagesEl, report } from "./render.js";
import { edit, selectionRanges } from "./edit.js";

interface CommentInfo { id: number; author: string | null; text: string; resolved: boolean }
interface CommentSpan { id: number; path: string; start: number; end: number }

let commentsOn = false;
export const isCommentsOn = () => commentsOn;

const fetchSpans = (): CommentSpan[] => JSON.parse(S.conv.comment_spans());
const fetchList = (): CommentInfo[] => JSON.parse(S.conv.comment_list());

// Overlay rects over every hit segment a comment anchor covers — the
// same shape as the find highlights; spans are re-read on every draw
// because edits shift char offsets.
export function drawCommentHl() {
  document.querySelectorAll(".commenthl").forEach((n) => n.remove());
  if (!commentsOn) return;
  let spans: CommentSpan[];
  try { spans = fetchSpans(); } catch (e) { return; }
  for (const sp of spans) {
    for (const h of allHits()) {
      if (h.path !== sp.path || h.start === null) continue;
      const len = chars(h.text).length;
      const k1 = Math.max(sp.start, h.start) - h.start;
      const k2 = Math.min(sp.end, h.start + len) - h.start;
      if (k2 <= k1) continue;
      const svg = pagesEl.children[h.page - 1];
      if (!svg) continue;
      const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      r.setAttribute("x", String(h.x + cum(h, k1)));
      r.setAttribute("y", String(h.y - 0.85 * h.size));
      r.setAttribute("width", String(cum(h, k2) - cum(h, k1)));
      r.setAttribute("height", String(1.1 * h.size));
      r.setAttribute("fill", "#34a853");
      r.setAttribute("opacity", "0.25");
      r.setAttribute("class", "commenthl");
      svg.appendChild(r);
    }
  }
}

export function toggleComments(on?: boolean) {
  commentsOn = on ?? !commentsOn;
  let n = 0;
  try { n = fetchList().length; } catch (e) { /* no document */ }
  drawCommentHl();
  report(commentsOn ? `주석 표시 켬 (${n}개)` : "주석 표시 끔");
}

// The comment id under the caret (independent of the display toggle),
// for the delete / resolve actions.
export function commentIdAtCaret(): number | null {
  if (!S.caret) return null;
  try {
    const c0 = S.caret;
    const sp = fetchSpans().find((x) => x.path === c0.path && c0.off >= x.start && c0.off < x.end);
    return sp ? sp.id : null;
  } catch (e) { return null; }
}

// ---- authoring (comment bar + menu actions) --------------------------------

const cbar = () => document.getElementById("commentbar")!;
const cq = () => document.getElementById("commentq") as HTMLInputElement;
let pendingRange: { path: string; start: number; end: number } | null = null;

export function openCommentBar() {
  const ranges = selectionRanges();
  if (!ranges || ranges.length !== 1 || !/^d\/\d+$/.test(ranges[0].path)) {
    report("주석: 본문 문단 안에서 텍스트를 선택하세요");
    return;
  }
  pendingRange = ranges[0];
  cbar().hidden = false;
  cq().value = "";
  cq().focus();
}

export function closeCommentBar() {
  cbar().hidden = true;
  pendingRange = null;
}

export function applyComment(text: string) {
  const r = pendingRange;
  if (!text || !r) { report("주석: 대상 선택과 내용이 필요합니다"); return; }
  edit(() => {
    const json = S.conv.add_comment(r.path, r.start, r.end, "rdoc", text);
    S.caret = { path: r.path, off: r.end };
    S.sel = null;
    return json;
  });
  closeCommentBar();
  if (!commentsOn) toggleComments(true);
  else drawCommentHl();
}

export function removeCommentAtCaret() {
  const id = commentIdAtCaret();
  if (id === null) { report("주석: 캐럿을 주석 범위에 두세요"); return; }
  const keep = S.caret && { ...S.caret };
  edit(() => {
    const json = S.conv.remove_comment(id);
    S.caret = keep;
    S.sel = null;
    return json;
  });
}

export function resolveCommentAtCaret() {
  const id = commentIdAtCaret();
  if (id === null) { report("주석: 캐럿을 주석 범위에 두세요"); return; }
  let resolved = true;
  try {
    const cur = fetchList().find((c) => c.id === id);
    resolved = !(cur && cur.resolved);
  } catch (e) { /* default to resolving */ }
  const keep = S.caret && { ...S.caret };
  edit(() => {
    const json = S.conv.resolve_comment(id, resolved);
    S.caret = keep;
    S.sel = null;
    return json;
  });
  report(resolved ? "주석을 해결됨으로 표시" : "주석 해결을 취소");
}

export function wireCommentBar() {
  const q = cq();
  q.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); applyComment(q.value.trim()); }
    else if (e.key === "Escape") { e.preventDefault(); closeCommentBar(); }
    e.stopPropagation();
  });
  document.getElementById("commentapply")!.onclick = () => applyComment(q.value.trim());
  document.getElementById("commentclose")!.onclick = closeCommentBar;
}

// The comment under the caret as a status-line string, or null.
export function commentAtCaret(): string | null {
  if (!commentsOn || !S.caret) return null;
  try {
    const c0 = S.caret;
    const sp = fetchSpans().find((x) => x.path === c0.path && c0.off >= x.start && c0.off < x.end);
    if (!sp) return null;
    const c = fetchList().find((x) => x.id === sp.id);
    if (!c) return null;
    return `주석(${c.author ?? "?"})${c.resolved ? " [해결됨]" : ""}: ${c.text}`;
  } catch (e) { return null; }
}

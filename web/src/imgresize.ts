// Resize handle for the click-selected inline image: a square at the
// image's bottom-right corner; dragging it scales a ghost outline and
// commits a proportional width change on release (one history entry).

import { S } from "./state.js";
import { pagesEl } from "./render.js";
import { edit } from "./edit.js";

const H = 8; // handle square size, pt

let drag: {
  index: number;
  svg: SVGSVGElement;
  x: number; y: number; w: number; h: number; // image bounds, pt
  ghost: SVGRectElement;
} | null = null;

export const isImageResizeDrag = () => drag !== null;

function ptOf(svg: SVGSVGElement, clientX: number, clientY: number) {
  return new DOMPoint(clientX, clientY).matrixTransform(svg.getScreenCTM()!.inverse());
}

export function clearImageHandle() {
  document.querySelectorAll(".imghandle").forEach((n) => n.remove());
}

/** Show the corner handle for the currently selected image. */
export function drawImageHandle() {
  clearImageHandle();
  const sel = S.imageSel;
  if (!sel) return;
  const img = sel.el;
  const svg = img.ownerSVGElement;
  if (!svg) return;
  const x = +img.getAttribute("x")!, y = +img.getAttribute("y")!;
  const w = +img.getAttribute("width")!, h = +img.getAttribute("height")!;
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("x", String(x + w - H / 2));
  rect.setAttribute("y", String(y + h - H / 2));
  rect.setAttribute("width", String(H));
  rect.setAttribute("height", String(H));
  rect.setAttribute("fill", "#fff");
  rect.setAttribute("stroke", "#1a73e8");
  rect.setAttribute("stroke-width", "0.7");
  rect.setAttribute("class", "imghandle");
  rect.setAttribute("style", "cursor:nwse-resize");
  svg.appendChild(rect);
}

export function wireImageResize() {
  // Capture phase: the handle grab must win over image re-selection.
  pagesEl.addEventListener("mousedown", (e) => {
    const sel = S.imageSel;
    if (!sel || !(e.target as Element).classList?.contains("imghandle")) return;
    const svg = sel.el.ownerSVGElement;
    if (!svg) return;
    e.preventDefault();
    e.stopPropagation();
    const x = +sel.el.getAttribute("x")!, y = +sel.el.getAttribute("y")!;
    const w = +sel.el.getAttribute("width")!, h = +sel.el.getAttribute("height")!;
    const ghost = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    ghost.setAttribute("x", String(x));
    ghost.setAttribute("y", String(y));
    ghost.setAttribute("width", String(w));
    ghost.setAttribute("height", String(h));
    ghost.setAttribute("fill", "none");
    ghost.setAttribute("stroke", "#1a73e8");
    ghost.setAttribute("stroke-width", "0.8");
    ghost.setAttribute("stroke-dasharray", "3 2");
    ghost.setAttribute("class", "imgghost");
    svg.appendChild(ghost);
    drag = { index: sel.index, svg, x, y, w, h, ghost };
  }, { capture: true });

  window.addEventListener("mousemove", (e) => {
    if (!drag) return;
    const pt = ptOf(drag.svg, e.clientX, e.clientY);
    const w = Math.max(10, pt.x - drag.x);
    drag.ghost.setAttribute("width", String(w));
    drag.ghost.setAttribute("height", String(w * drag.h / drag.w));
  });

  window.addEventListener("mouseup", (e) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    d.ghost.remove();
    const newW = Math.max(10, ptOf(d.svg, e.clientX, e.clientY).x - d.x);
    if (Math.abs(newW - d.w) < 0.5) return; // a click, not a resize
    clearImageHandle();
    edit(() => S.conv.resize_image(d.index, newW));
  }, { capture: true });
}

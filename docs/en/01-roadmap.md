# Roadmap

Every stage has to pass a verification gate — measured evidence plus user
confirmation — before the next one begins. Prototypes 1-3 are done
([../ko/worklog/2026-08-21.md](../ko/worklog/2026-08-21.md), Korean).

## Done

- **Prototype 1 — SVG renderer**: rdocx `LayoutResult` → self-contained SVG
  with glyphs embedded as vectors. Gate: visually matches rdocx's own PNG
  backend. ✅
- **Prototype 2 — wasm**: parse → lay out → SVG in the browser, with a
  settled way to inject fonts. Gate: renders in under 100ms, shapes Korean. ✅
- **Prototype 3 — hit testing and the edit loop**: click → caret → typing →
  relayout. Gate: positions map back to the document and edits are measured
  as applied. ✅ (21-27ms per keystroke)

## Next

### S1. A read-only viewer as a product
- Multi-page view, scrolling, zoom; robustness on arbitrary docx (tested
  against a corpus of real documents)
- Fill the renderer's gaps: gradients, clip paths, group effects
- Text selection by dragging, plus copy to clipboard
- Gate: N real documents render comparably, selection and copy measured

### S2. Editing MVP
- Delete/replace a selection, Enter (paragraph split), formatting toggles
  (B/I/U)
- Undo/redo (command pattern)
- IME composition input (Korean — composition events)
- Gate: an automated typing scenario, plus the saved docx re-verified in
  Word and rdocx

### S3. Structural editing and performance
- Table cell editing — replace text matching with upstream provenance
  (the follow-up to #37) or a fork extension
- Incremental relayout (per-paragraph cache) — baseline: full relayout at
  21-27ms per keystroke
- Gate: typing latency target (<30ms) met on a 50-page document

### S4. Collaboration and extensions
- Comment and track-changes UI (converging with upstream M14)
- An MCP server (AI agents editing documents)

## Upstream strategy

- If #37 is accepted: drop the fork dependency and go back to crates.io.
- Provenance (source positions in the layout output) is to be proposed
  upstream before S3. If it is refused, maintaining a fork of rdocx-layout
  becomes the official line (the decision goes in decisions.md).

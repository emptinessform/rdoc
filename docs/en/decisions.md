# Decision log

## D1. Build on rdocx instead of from scratch (2026-08-21)

Unlike HWP, DOCX already has an active open-source stack with a parser,
layout engine and renderer: rdocx (27 crates, 162K LOC, MIT/Apache-2.0).
Rebuilding that would only get us to today's rdocx two years from now. We
focus on the editor layer instead.
Risk: rdocx is effectively maintained by one person plus AI, and 0.x can
break compatibility — hedged by our right to fork.

## D2. Render to SVG, with glyphs embedded as vector paths (2026-08-21)

SVG over canvas: it integrates with the DOM (hit testing uses `data-hit`),
it ships as a self-contained document, and it is resolution independent.
Glyphs are deduplicated through `<defs>` + `<use>`, so a page renders
identically regardless of the fonts on the viewer's machine (~40KB gzipped
per page).
Coordinate-precision lesson: scale values need 7 decimal places — rounding
to 2 introduced a 28% error.

## D3. Minimal upstream patches plus public proposals, on a rev-pinned fork (2026-08-21)

The APIs we need (`layout()`, `layout_with_fonts()`) are kept as a 22-line
patch and proposed upstream as #37. Until it is accepted we depend on
emptinessform/rdocx@svg-poc at a pinned rev. Keeping the patch minimal keeps
the cost of rebasing down.

## D4. Map layout positions back by text matching, for now (2026-08-21)

The layout output carries no source positions (provenance), so we recover
them by sequential text matching (156/174 = 89% of the demo document mapped).
Table cells and markers are explicitly marked non-editable. The real fix —
carrying source positions through layout — is to be proposed upstream before
S3: matching breaks on documents that repeat the same wording, which is not
good enough for a product.

## D5. Follow the rhwp methodology (2026-08-21)

AI pair programming with verification first and a human checking every stage.
Every stage is recorded in the worklog with measured evidence, and has to
pass a user confirmation gate before the next one starts. The rules live in
CLAUDE.md.

## D6. Korean and English in parallel, and a multilingual structure (2026-09-07)

Both the docs and the product ship in Korean and English. The docs are
mirrored trees under `docs/ko/` and `docs/en/`, and a new document is written
into both under the same filename. Retroactive translation covers the durable
documents (README, decisions, 01-roadmap, knowledge); the 77 past worklogs
stay Korean-only, because they are lab records and the translation cost buys
little. In the product, UI strings are collected into locale tables under
`web/src/i18n/` (S63).

Names settled at the same time: the product is **rdoc editor**, and the native
verification binary went from `--bin poc` to `--bin render` — it renders and
dumps hit data, it does not edit. The fork branch `svg-poc-0.12` keeps its
name for now because upstream issues #67 and #69 refer to it by name; the next
upstream migration will create a branch under the new naming.

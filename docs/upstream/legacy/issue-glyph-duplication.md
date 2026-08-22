# [DRAFT — 게시 전 확인] Bug report: duplicated glyph at intra-line break opportunities

> 게시 대상: https://github.com/tensorbee/rdocx/issues
> 상태: 초안. 게시 전에 최신 main으로 재현 확인 필요.

## Title

Glyph duplicated at line-break opportunities: "ttf-parser" renders as "ttf-pparser"

## Body

**Version:** 0.7.0 (also reproduced on main @ cd3b341, 2026-08-21)

**Summary:** When a shaped run contains an intra-line break opportunity that is
*not* taken (the line does not wrap there), the glyph following the break
opportunity is rendered twice. The document text itself is correct — the
duplication appears in layout output, so every backend (PDF, PNG, and an
external renderer consuming `LayoutResult`) shows it identically.

**Repro:**

```rust
use rdocx::Document;

let mut doc = Document::new();
doc.add_paragraph("Glyph outlines extracted with ttf-parser");
doc.add_paragraph("(shaping, line breaking, pagination) and rendered");
let png = doc.render_page_to_png(0, 120.0); // or save_pdf
```

**Observed rendering:**

- `ttf-parser` → `ttf-pparser` (duplicate after the hyphen)
- `) and rendered` → `) aand rendered` (duplicate after `) `)
- `outlines extracted` → `outlines  extracted` (duplicated space)

**Pattern:** each duplication site is exactly a UAX #14 break opportunity
(after `-`, after a space) that was not taken as an actual line break. This
suggests the shaped glyph sequence is being split into segments at break
opportunities with an off-by-one overlap: the boundary glyph lands in both the
segment before and the segment after the break candidate.

**Where I looked:** the duplicated glyphs are present in
`LayoutResult`/`GlyphRun` content (confirmed by consuming the staged layout
output directly with an external renderer), so the issue is upstream of the
PDF/PNG backends — likely in `oxml-layout`'s `break_into_lines` /
`rdocx-layout`'s run segmentation.

Happy to provide the full test document or bisect further if useful.

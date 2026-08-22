# 업스트림 이슈 초안 (tensorbee/rdocx)

> 게시 완료 (2026-08-23): 이슈 https://github.com/tensorbee/rdocx/issues/42 ,
> 드래프트 PR https://github.com/tensorbee/rdocx/pull/43 (#41 스택).

**Title:** Dense form documents render broken: nested tables are
flattened, vMerge/exact row heights are ignored, and table-style
borders/spacing never apply

**Body:**

While building the SVG/editor PoC on 0.8.0 we fed it a real Korean
hospital fee receipt — the kind of dense form that packs the whole
page into one outer table with six nested tables, 135 gridSpans, 59
vertical merges, 44 `trHeight hRule="exact"` rows, all of its grid
lines and paragraph spacing supplied by the table style, and floating
stamp/seal drawings anchored inside cells.

Word renders it as one page. rdocx 0.8.0 renders four pages with no
table structure at all. Tracing that gap surfaced seven independent
layout defects; each is small, but dense forms hit all of them at
once:

1. **Nested tables are flattened.** `layout_cell_content` lays the
   inner table out, then discards the block and dumps its cell
   paragraphs as a flat stream (the `// For now, flatten` TODO in
   table.rs). Any form built as tables-within-a-table loses its
   entire structure.
2. **vMerge=restart cells balloon their row.** The merged content's
   full height lands in the starting row instead of spreading across
   the span, and the renderer draws insideH borders straight through
   merged regions.
3. **`trHeight hRule="exact"` is ignored.** The parser keeps the
   attribute, the layout never reads it; 44 pinned rows each grew by
   the empty-paragraph fallback.
4. **Table styles never cascade.** The styles parser drops a table
   style's `<w:tblPr>` entirely — which also means a load/save round
   trip silently deletes it from styles.xml — so `Table Grid`'s
   borders draw nothing, and its `spacing after=0` paragraph override
   never reaches cell paragraphs (every row gains the docDefaults
   8pt).
5. **Empty paragraphs use a 12pt no-metrics fallback** and ignore the
   paragraph mark's rPr, so empty 7pt form cells become 12pt rows.
6. **Drawings anchored to cell paragraphs are computed and thrown
   away** — stamps, seals, and watermarks inside table cells never
   render; behindDoc ones must also compose under the whole page,
   not just their own cell.
7. **Outer-edge borders: cell `nil` vs the table border.** The form's
   box declares `<w:top w:val="nil"/>` on first-row cells while the
   style supplies the outline. ECMA-376 says nil wins (no line); Word
   draws the table border at the table's outer boundary anyway. We
   matched Word at the outer edges only and would value your read on
   this spec/Word divergence.

With the fixes the receipt renders as a single page structurally
matching Word's output, and a 22-document real corpus (receipts,
delivery forms, design specs) lays out with zero crashes and exact
page-count matches against every available reference PDF.

Draft PR incoming on top of #41 (the empty-paragraph fix builds on
the zero-width segment introduced there). Happy to split or reorder
however fits the S52 plan.

---

# 드래프트 PR 초안

**Branch:** `emptinessform:fx-dense-form-layout` → `tensorbee:main`
(stacked on #41 / `fx040-restart-pagination`)

**Title:** Dense-form layout: nested tables, vertical merges, exact
rows, table-style cascade, cell-anchored drawings

**Body:**

Fixes the seven defects described in #42 (companion issue), one
review-sized commit per concern, stacked on #41 because the
empty-paragraph metrics fix extends the zero-width segment introduced
there:

- `83f761a` styles: preserve a table style's `<w:tblPr>` verbatim
  (round-trip fidelity) and parse its `tblBorders` into a typed view.
- `bf488f4` layout: keep nested tables as recursively rendered
  blocks; distribute vMerge spans with merged-span painting and
  crossing-border suppression; honour `hRule="exact"`; cascade
  table-style borders (basedOn chain) and table-style pPr between
  docDefaults and the paragraph style; give empty paragraphs real
  line metrics from the paragraph mark's rPr.
- `699ca61` borders: at the table's outer boundary a cell border of
  none/nil yields to the table-level border (Word behavior; interior
  edges keep spec suppression). Flagged in the issue for a fidelity
  decision.
- `8f7e142` anchors: render drawings anchored to cell paragraphs;
  behindDoc ones compose into the page's behind layer.
- `3ce76f9` api: `Paragraph::add_run_inheriting_mark` — text typed
  into an empty paragraph takes the paragraph mark's run properties,
  as Word does.

Tests: rdocx-layout 147 green (nested-table dimensions test updated
to the new model), rdocx-oxml 275 green. Validated against a real
hospital receipt (4 broken pages → Word's exact 1 page) and a
22-document corpus with reference-PDF page-count parity.

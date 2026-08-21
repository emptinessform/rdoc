# [DRAFT — 게시 전 사용자 확인 필요] Source provenance on layout output

> 게시 대상: https://github.com/tensorbee/rdocx/issues (새 이슈)
> 선행: #37 (layout accessor) — 이 제안은 그 후속.
> 아래 본문이 게시될 영어 원문.

## Title

Carry source positions through layout so GlyphRuns can be traced back to the document model

## Body

This is a follow-up to #37, from the same editor-layer work. #37 exposes the
layout *output*; this proposes making that output *traceable back to the
document*, which is the piece an interactive viewer or editor cannot
reconstruct from outside.

**Problem.** A `GlyphRun` carries positioned glyphs and the original text,
but nothing that says *where in the document* it came from. For hit testing
(click → caret position), selection, and edit round-trips, an external
consumer currently has to re-derive that mapping by matching `GlyphRun.text`
against paragraph texts in reading order. I have this working as a fallback,
and its limits are exactly what you would expect:

- On a styled demo document, sequential text matching resolves 156/174
  segments; the unmatched remainder is precisely the content whose position
  is not expressible as "nth body paragraph, char offset": table cell text,
  list markers, header/footer text.
- Repeated phrases are genuinely ambiguous — matching can lock onto the
  wrong occurrence and every downstream edit lands in the wrong place.
- CJK text segments to one or two characters per run after line breaking,
  so the matcher is choosing among many near-identical tiny fragments.

**Proposal.** Thread an optional, format-neutral source reference from
`rdocx-layout`'s conversion step through shaping and line breaking:

```rust
// oxml-layout (format-neutral)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SourceSpan {
    /// Caller-defined node id; the format layer decides the encoding.
    pub node: u64,
    /// Char offset of this segment's first char within that node's text.
    pub char_start: u32,
}

pub struct TextSegment { /* existing fields */ pub source: Option<SourceSpan>, }
pub struct GlyphRun    { /* existing fields */ pub source: Option<SourceSpan>, }
```

- `oxml-layout` stays format-agnostic: `node` is opaque to it; it only has
  to (a) copy `source` from segment to run and (b) advance `char_start` when
  a segment is split at a line-break opportunity — the same places that
  already slice `text`, `glyph_ids`, and `advances`.
- `rdocx-layout` defines the encoding of `node` for WordprocessingML (body
  paragraph index; table path row/col/paragraph; header/footer part +
  paragraph; marker = none). A small enum + `From<u64>`-style codec, or a
  side table in `LayoutResult`, whichever you prefer.
- Cost when unused: `None` everywhere, one `Option<SourceSpan>` (12 bytes)
  per segment/run.

**Compatibility.** `GlyphRun` and `TextSegment` are exhaustive structs with
public fields, so adding a field is a breaking change for literal
constructors. If that is a concern I am happy to gate it behind a
constructor/builder instead, or to hold the change for a minor bump you
already have planned.

**Offer.** I will implement this as a PR (including the split-at-break
`char_start` adjustment and tests) if the shape looks acceptable — happy to
iterate on naming and on where the Word-side encoding should live. The
editor layer consuming it is public at https://github.com/emptinessform/rdoc,
so the API gets an immediate real consumer and test surface.

One more data point for motivation: the text-matching fallback is also how I
found the duplicated-glyph correlation posted on #23 — segments and their
source text disagreeing is visible from outside, but only fixable with real
provenance.

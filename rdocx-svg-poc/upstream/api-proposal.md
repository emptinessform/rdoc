# [DRAFT — 게시 전 확인] Feature proposal: public layout accessor on `Document`

> 게시 대상: https://github.com/tensorbee/rdocx/issues (discussion) 또는 PR
> 상태: 초안. 첨부 패치: `layout-accessor.patch`

## Title

Expose the full `LayoutResult` (pages + fonts) so external renderers can build on rdocx-layout

## Body

**Motivation.** `Document::layout_page()` returns positioned `PageFrame`s, but
the `FontData` (raw TTF bytes + `FontId` mapping) lives only inside the
private cached `LayoutResult`, consumed by the built-in PDF/PNG backends. An
external renderer cannot resolve `GlyphRun.glyph_ids` without those font
bytes, so today the layout engine is effectively closed to third-party
backends.

**Use case.** I built a proof-of-concept SVG backend on top of
`rdocx-layout`'s output: glyph outlines are extracted from `FontData` with
ttf-parser, deduplicated into `<defs>`, and placed with `<use>` — producing a
self-contained vector page that renders identically without any fonts
installed. It works on native and on wasm32 (where the caller supplies font
bytes, since system font discovery is unavailable). The only change rdocx
needed was this accessor. The same API would serve anyone building an
interactive viewer/editor layer, a canvas renderer, or hit-testing.

**Proposed API** (patch attached):

```rust
/// Full cached layout: positioned pages plus the fonts used.
pub fn layout(&self) -> Result<Arc<oxml_layout::LayoutResult>>;

/// Like `layout()` but with caller-provided fonts, for wasm32 where
/// system font discovery is unavailable. Mirrors `to_pdf_with_fonts`.
pub fn layout_with_fonts(
    &self,
    font_files: &[(&str, &[u8])],
) -> Result<oxml_layout::LayoutResult>;
```

Both mirror what `to_pdf` / `to_pdf_with_fonts` already do internally; no new
layout code paths. `LayoutResult` is already `#[non_exhaustive]`, so this
does not widen the semver surface beyond what the type already commits to.

Open questions I'd want maintainer input on:

- Should `layout()` return `Arc<LayoutResult>` (sharing the cache, as in the
  patch) or a clone, to keep `Arc` out of the public signature?
- Should `layout_with_fonts` participate in the layout cache keyed by the
  font set, or stay uncached as proposed?
- Is `RenderOptions` (revision views) wanted on these accessors from day one?

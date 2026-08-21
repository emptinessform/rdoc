# [DRAFT — 게시 전 사용자 확인 필요] Performance: relayout caching contribution

> 게시 대상: https://github.com/tensorbee/rdocx/issues (새 이슈)
> 첨부 브랜치: https://github.com/emptinessform/rdocx/tree/perf-caches
>   (main 기반, 3파일 +193/−30, PoC 패치와 분리된 순수 성능 변경)
> 아래가 게시될 영어 원문.

## Title

Relayout is dominated by repeated font work; four caches take a 63-page edit from 1,144ms to 101ms

## Body

Same editor-layer work as #37/#38, now the performance side. An interactive
consumer relayouts after every edit, which turns per-layout costs that are
invisible in one-shot conversion into per-keystroke costs. Profiling a
63-page mixed Latin/Korean document (700 paragraphs, 14 tables) on Windows
with CJK font collections installed:

| stage | cost per relayout |
|---|---|
| `fontdb::load_system_fonts()` in `FontManager::new()` | ~750ms (full scan + parse of installed fonts, every layout) |
| `with_face_data` on file-backed faces | ~230ms (13–20MB CJK files re-read + copied per resolution) |
| paragraph block building (style resolution + shaping + line items) | ~100ms |
| pagination | ~19ms |

I have a working branch with four independent caches, measured cumulatively
on that document (full relayout per edit, n=10):

1. **System font discovery once per process** — build the bundled+system
   `fontdb::Database` in a `OnceLock`, clone per `FontManager` (face tables
   only). 1,144ms → 397ms.
2. **File-backed face bytes cached process-wide**, keyed by path+index;
   in-memory faces (bundled, user-provided) stay uncached. Gated to the
   `system-fonts` feature (`Source::File` does not exist without fontdb's
   `fs`). 397ms → 169ms — matching the bundled-fonts-only floor.
3. **Shaping memo** on `FontManager`: `(font id, text+size hash) →
   ShapedText`, interior mutability so `shape_text(&self)` is unchanged.
4. **Paragraph block cache** on a now-reusable `Engine`: laid-out
   `ParagraphBlock`s keyed by paragraph XML + content width + revision view
   + font-set fingerprint. **Marker-bearing paragraphs are never cached**,
   so `NumberingState` still advances through every numbered paragraph and
   list numbering stays correct. With `rdocx::Document` holding one engine
   across layouts: 169ms → 101ms (block building 100ms → 32ms).

Branch: https://github.com/emptinessform/rdocx/tree/perf-caches (single
commit on top of current main; +193/−30 across `oxml-layout/src/font.rs`,
`rdocx-layout/src/engine.rs`, `rdocx/src/document.rs`). Suites pass here:
oxml-layout 62+3, rdocx-layout 111+1, rdocx 128 with the same 3
machine-dependent fixture failures as clean main; wasm32 builds.

Known limits, stated rather than hidden:

- The block cache fingerprints the paragraph itself, not style
  *definitions*: editing a style's definition can serve a stale block until
  the cache is cleared. If that matters for v1 semantics, the cache could
  be keyed on a styles-generation counter or simply cleared on style
  mutation — happy to wire whichever you prefer.
- The paragraph fingerprint currently hashes `format!("{:?}")` of the
  paragraph (~0.03ms each); a dedicated walker would roughly halve the
  remaining block-stage cost.
- Caches 1–2 are process-global statics; 3–4 live on
  `FontManager`/`Engine`. If globals conflict with your determinism goals
  they can move onto an explicit session type — F-X032's accessor work may
  be the natural place to decide where a persistent engine should live.

If the direction fits S51 or later, I will send this as a PR (split into
smaller commits if you prefer) and adapt it to the F-X032/F-X037 shapes as
they land.

# 업스트림 피드백 초안 (tensorbee/rdocx — 새 이슈)

> 상태: **게시됨 — 이슈 #46** (2026-08-24, 사용자 승인).
> https://github.com/tensorbee/rdocx/issues/46
> 근거 수치: S55 스파이크(docs/worklog/2026-08-24-s55-v090-spike.md),
> 동일 세션 교차 측정, 2026-08-24.
> 대체 대상: 2026-08-23-s52-perf-feedback-draft.md (미게시 폐기, s52 기준).

**Title:** v0.9.0 editor path: typing ~2-3x and undo ~4x slower than the
#40/#41 reference implementations (note ops recovered)

**Body:**

Congratulations on v0.9.0, and thank you for the credits on #23, #39,
#40, #41, #42 and #43. We rebuilt our editor stack on the release
(branch `emptinessform/rdocx@svg-poc-0.9`: v0.9.0 plus our editor-only
APIs) and can confirm two things before the performance report.

**F-X048 fully replaces our dense-form work.** We dropped all four of
our dense-form commits (nested tables, grid-span vertical merges, exact
rows and table-style cascade, cell-relative anchors, outer-border
fallback) and our corpus renders identically to our pinned pre-release
build: same page counts, same laid-out run counts, same source
mappings on all 14 documents, and our 50-scenario browser editor suite
passes unchanged. #42 can stay closed with confidence.

**The note-operation regression we saw on `sprint/s52` is gone.**
Footnote insert/delete are back at parity (~80-100 ms, versus the
300-456 ms we measured on the sprint branch). Whatever changed between
the sprint branch and the release fixed that path.

**What remains is the typing path.** Same workload as #39/#41: a
63-page, 700-paragraph mixed Korean/Latin document, mutate
mid-document, re-layout through the persistent engine, warm
measurements, Windows x64 release build. We interleaved the two builds
in one session (A/B/A/B, four pairs) to keep machine state out of it:

| operation | #40/#41 reference impls | v0.9.0 | ratio |
|---|---|---|---|
| keystroke re-layout, native (min) | 36-40 ms | 71-88 ms | ~2.1x |
| keystroke re-layout, wasm (mean) | 96-113 ms | 317-336 ms | ~3.0x |
| document load, wasm | 4.6-5.7 s | 15.0-17.7 s | ~3.0x |
| undo, wasm | 148-165 ms | 608-614 ms | ~4.0x |
| cell merge, wasm | 152 ms | 335-365 ms | ~2.3x |

The wasm column is the editor as users experience it (bundled-fallback
layout with caller font aliases); the native column is the same
document through `Document::layout`, so the regression is not specific
to the wasm target or to the alias path. Load and undo scaling worse
than typing suggests the cold/rebuild path rather than per-keystroke
lookup cost: undo swaps in a restored document and transfers the engine
via `transfer_reusable_bundled_fallback_layout_from`, so if that
compatibility check now rejects more often, undo would fall back to a
cold layout — which is roughly the ratio we measure.

Repro: `crates/rdoc-core/src/bin/bench.rs` in `emptinessform/rdoc`
generates the document and prints these timings; point its
`rdocx`/`oxml-layout` dependencies at `svg-poc-0.9` versus
`svg-poc-0.8` to A/B. One caveat that cost us a run: a
`[patch."<git url>"]` entry does **not** apply to a `rev`-pinned git
dependency, so the swap has to be a real dependency edit.

Happy to bisect against candidate fixes or run instrumented builds, as
in the #39 cycle. For now our editor stays on the pre-release
implementations and we will migrate as soon as the typing path is back
inside budget.

**Migration note (separate, minor).** `PositionedElement` gained
`MarkedContent { structure, children }` and became `#[non_exhaustive]`.
An external backend that walks `PageFrame::elements` keeps compiling
and silently renders nothing, because all content now arrives inside
the new wrapper. It cost us a debugging session; a line in the
changelog's compatibility section would save the next backend author
the same trip. (Our fix was three recursive arms, no complaint about
the design — tagged structure is clearly worth it.)

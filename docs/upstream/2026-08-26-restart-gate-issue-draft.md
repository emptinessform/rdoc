# 업스트림 이슈 초안 (2026-08-26, v2) — 각주 하나가 증분 재레이아웃을 끈다

- 대상: tensorbee/rdocx, 새 이슈 (#46은 종결됨)
- 상태: **미게시 — 사용자 승인 대기**
- v1 대비: `lines.len() <= 2` 원인설을 **철회**(런타임 오버라이드로 반증).
  각주 조건만 단일 변수로 확인해 헤드라인으로 삼고, 구체적 수정안 3개
  (비용 순)와 "우리가 못 밝힌 것" 절을 추가.

---

**Title**

`v0.10.1`: a single footnote disables restart pagination for the whole
document — F-X052 is ~2x faster than the #40/#41 reference without one, ~2x
slower with one

**Body**

Thank you for F-X052, and for the #46 credit. I re-ran the migration spike on
`v0.10.1` and found something I think is worth a separate report, because
**F-X052 is genuinely faster than our reference implementation when it
engages**. The trouble is a single-variable cliff.

## Setup

Fork branch `svg-poc-0.10` = `v0.10.1` + our editor commits. The three font
alias commits are gone — F-X051 supersedes them with identical signatures,
thank you. Reference is our pinned `v0.8.0`-based branch carrying the
#40/#41 implementations. A/B is interleaved in one session using path
dependencies (a `[patch]` entry does not apply to rev-pinned git deps), cold
passes discarded.

Functional parity is complete: a 14-document corpus with identical
page/run/mapping counts, a 50-suite browser battery at 50/50, 272 hit runs,
an identically sized page SVG, and 57 pages on both pins.

## The cliff

One document, 700 short paragraphs, one variable changed at a time. Full
relayout per keystroke, mean of 10, three repetitions:

| document | reference | v0.10.1 |
|---|---|---|
| baseline | 8 / 8 / 14 ms | **3 / 5 / 3 ms** |
| + 14 tables | 9 ms | 5 ms |
| + one `Heading1` | — | 5 ms |
| + header and page-number footer | 8 / 9 / 8 ms | 5 / 7 / 10 ms |
| **+ ONE footnote** | 6 / 8 / 10 ms | **19 / 14 / 16 ms** |

Without a footnote `v0.10.1` is about twice as fast as the reference. Adding
one footnote to the same 700-paragraph document makes it about four times
slower than itself, and about twice as slow as the reference — which is
completely unaffected by the same change.

This matches an explicit condition in
`crates/rdocx-layout/src/engine.rs` (v0.10.1, ~line 1236):

```rust
let restart_record_eligible = sections.len() == 1
    && input.document.background_xml.is_none()
    && input.footnotes.is_none()      // <-- one footnote anywhere
    && input.endnotes.is_none()
    && !document_wraps
    && sections[0].header_footer.is_none()   // <-- and any header/footer
    && ...all(|(content, block)| ...);
```

The predicate is document-global: the presence of a footnote *anywhere*
disqualifies *every* subsequent keystroke, even when the edit is in body text
hundreds of paragraphs away and the footnote set never changes. The
header/footer row above is the same shape, milder.

For contrast, the #40/#41 implementation gates on: one section, block
fingerprints available, and no floating drawings. Footnotes and headers are
folded into an environment fingerprint (`env_fp`) instead of disqualifying
reuse, which is why the reference line in that table does not move.

## What this costs in production

Our wasm editor (Korean corpus, caller fonts and aliases, same document both
arms, warm passes, three runs each):

| | reference | v0.10.1 | ratio |
|---|---|---|---|
| typing, mean | 93 / 99 / 108 ms | 148 / 130 / 160 ms | ~1.46x |
| document load | 4.82 / 4.94 / 4.75 s | 8.00 / 5.90 / 6.29 s | ~1.4x |
| undo after a structural edit | 124 / 139 / 124 ms | 310 / 202 / 319 ms | ~2.15x |

And on our 63-page editor bench, once footnotes exist, the relayout after an
insert-footnote goes from 54-89 ms to 724-1334 ms; delete-footnote from
45-86 ms to 524-1312 ms.

## Three ways to fix this, cheapest first

**1. Make footnotes part of the restart identity instead of a disqualifier.**
The cache already compares body identity (`RetainedBlock::matches`) to find
the first changed item. Extend the same idea one step: store a fingerprint of
the footnote/endnote set in `RestartCache`, replace
`input.footnotes.is_none()` with "the footnote fingerprint equals the cached
one", and invalidate the restart record when it differs. A body keystroke
does not touch the note set, so the common case becomes eligible again. This
is the smallest change and it matches how the #40/#41 implementation handled
the same problem with `env_fp`.

**2. If note layout must stay conservative, make the checkpoint conservative
rather than the document.** Keep note-bearing pages out of reuse: allow
restart to resume only from checkpoints at page boundaries where no note area
was emitted, and rebuild from there. Documents with a handful of footnotes
then pay for the pages that actually carry notes, not for all 63.

**3. Apply the same treatment to `header_footer.is_none()`** — a header is
present in nearly every real Word document, and the header/footer row above
shows it already erases the F-X052 advantage on its own. A header fingerprint
folded into the restart environment key would be the same one-condition
change as (1).

We would be glad to test a branch against this workload and report numbers.

## What I could NOT show

Being explicit so this does not send anyone down the wrong path:

- **The `paragraph.lines.len() <= 2` cap is not the cause of anything I
  measured.** I patched it to be runtime-overridable and swept it at 2, 4 and
  64 on a 63-page document of 4-line paragraphs: 31-45 ms across every cap,
  with the caps indistinguishable from each other. My first hypothesis was
  wrong and I am retracting it.
- Long paragraphs *do* still cost `v0.10.1` more than the reference
  (4-line paragraphs, 63 pages: 42-52 ms vs 31-41 ms), but since the cap is
  not responsible I do not have an explanation for that one.
- I could not reconcile every magnitude: our 63-page bench shows 2.4x for
  typing while a bench2 document of the same shape shows 1.27x, and I did not
  chase the difference.

The footnote result is the one I would act on: it is a single variable, it is
reproducible in three runs on both pins, and it maps onto a condition that is
right there in the source.

Reproduction: `crates/rdoc-core/src/bin/bench2.rs` in
[emptinessform/rdoc](https://github.com/emptinessform/rdoc) builds each row of
the table from `RDOC_BENCH2_NOTES` / `RDOC_BENCH2_HF` / `RDOC_BENCH2_LONG` /
`RDOC_BENCH2_TABLES` / `RDOC_BENCH2_HEADING`.

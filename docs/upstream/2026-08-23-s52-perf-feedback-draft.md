# 업스트림 피드백 초안 (tensorbee/rdocx — 새 이슈)

> 상태: **보관 (미게시)** — 업스트림 S52 진행 상황을 보고 게시 여부 결정
> (2026-08-23 사용자 결정). 수치·재현 절차는 게시 시점에 재검증할 것.

**Title:** S52 editor benchmark: typing 2.4x and note insert/delete
~10x slower than the #40/#41 reference implementations

**Body:**

Thank you for landing F-X039/40/43–47 — we rebuilt our editor stack on
`sprint/s52` the same day, dropping all nine of our performance
commits in favour of the hardened implementations (branch:
`emptinessform/rdocx@svg-poc-s52`, only editor APIs and the #42
dense-form fixes remain). Functional parity is complete: our full
browser editor suite (32 scenarios) and document corpus pass
unchanged, and the checked
`transfer_reusable_bundled_fallback_layout_from` slotted in as a
one-line replacement for the raw handoff. Nice to see #23's F-X041 in
the same sprint.

One regression to report, with numbers. Same workload as #39/#41: the
63-page / 700-paragraph mixed Korean/Latin document, mutate
mid-document then re-layout through the persistent engine, warm
measurements (n=10 for typing, three sites for structural ops),
Windows x64 release build.

| operation | #40/#41 reference impls | sprint/s52 |
|---|---|---|
| keystroke re-layout (mean/min) | 26 / 23 ms | 62 / 53 ms |
| Enter / merge / 2-paragraph delete | 32–39 ms | 42–101 ms |
| footnote insert / delete | 36–49 ms | 300–456 ms |

Two observations that may help localize it:

- The bounds are not the cause: `PARAGRAPH_CACHE_MAX_ENTRIES/BYTES`
  (4096 / 56 MiB) match what this document needs, and the run shows
  no eviction-shaped cliff.
- The footnote numbers look like a whole-document re-shape (~half of
  the 787 ms cold layout) triggered by a single note insertion. That
  pattern fits the paragraph-cache context folding note state
  coarsely — one new footnote invalidating every cached paragraph —
  and/or the restart-safe regions disengaging entirely for
  note-bearing documents. The keystroke delta (23 → 53 ms floor on a
  note-free document) suggests a second, smaller per-lookup cost on
  top.

Repro: the bench source is
`rdocx-svg-poc/src/bin/bench.rs` in `emptinessform/rdoc` (also
generates the document); point its Cargo deps at `sprint/s52` vs the
#40/#41 branches to A/B. Happy to bisect further against candidate
fixes or run any instrumented build — same offer as the #39 cycle.

For now our editor stays pinned to the pre-S52 reference
implementations and we will migrate as soon as the editor path is
back inside its budget.

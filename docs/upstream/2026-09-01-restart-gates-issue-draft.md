# Issue draft B — restart pagination never engages on ordinary prose

**Title**

v0.11.1: restart pagination cannot engage on ordinary prose — `lines.len() <= 2` disqualifies the document and 8 MiB is below what one is worth

**Body**

Separate from #53 and from the paragraph-cache issue filed alongside this one.
Restart pagination never engages on a document of ordinary prose, so every
keystroke re-paginates the whole document. Two independent conditions each
suffice to prevent it, so relaxing either alone changes nothing.

This is not specific to any one layout entry point. We first saw it through
`layout_with_fonts_aliases_and_bundled_fallback`, which our editor uses, but
plain `Document::layout()` shows the same thing as soon as the paragraphs are
longer than two lines: 700 four-line paragraphs relayout in 30-33 ms against
21-22 ms on our 0.8-based fork, consistently across three paired rounds. What
decides it is paragraph length, not the entry point.

## Condition 1 — the per-block gate is document-global

`restart_record_block_is_safe` requires of a paragraph:

```rust
paragraph.anchored.is_empty()
    && paragraph.lines.len() <= 2
    && paragraph.heading_level.is_none()
    && !paragraph.keep_next
    && !paragraph.keep_lines
```

and `restart_record_eligible` applies it with `all()` over the whole body. On a
700-paragraph document of ordinary prose, **701 of 715 blocks fail** — almost
all of them on `lines.len() <= 2`, because a normal paragraph wraps to more than
two lines. Raising that bound leaves exactly **one** failing block, the single
`Heading1`, and the document is still disqualified.

This is the same shape as the note/header condition you removed in F-X062: one
block anywhere costs the whole document its restart state.

## Condition 2 — the retained-page budget

Even with the gate satisfied, the record is never published:

```
restart cache candidate: bytes=25138353  budget=8388608  publish=false
```

`RESTART_CACHE_MAX_BYTES` is 8 MiB, which is what remains of the 64 MiB
`CACHE_MAX_BYTES` after the paragraph cache takes 50 MiB. A 58-page document's
retained page frames measure **25.1 MB**. A 22-page document measures 2.3 MB and
publishes fine, which is why short fixtures do not show this.

## Effect

700 paragraphs, 58 pages, five caller fonts and ~40 aliases, typing one
character per iteration. Native harness reproducing the browser path, best of
three alternating rounds:

| | pagination phase | total relayout |
|---|---|---|
| v0.11.1 as shipped | 35–41 ms | 52–63 ms |
| both conditions relaxed | **1.4–1.8 ms** | **21–28 ms** |
| our 0.8-based fork, same document | — | 31–39 ms |

With restart engaged, v0.11.1 is faster than the implementation we currently
ship. The gates, not the engine, are what cost us.

## But relaxing them naively is not the fix

We measured the relaxed build in the browser as well, alternating three wasm
bundles in one session, four rounds, medians in ms:

| | v0.8 fork | v0.11.1 | v0.11.1, both conditions relaxed |
|---|---|---|---|
| typing | 65 | 87 | **72** |
| initial load | 3853 | 4564 | **3950** |
| undo | 129 | 142 | **164** |
| Enter (paragraph insert) | 116 | 114 | **315** |

Typing and load recover, but Enter gets 2.7x worse and undo worsens too, on all
four rounds. We did not isolate why. It is not the cost of publishing the larger
record — we timed that at 0.6–0.9 ms for the 25 MB candidate. We are reporting
the measurement rather than a theory.

Functional equivalence held throughout: 50/50 browser suite, 14/14 corpus, 272
source-mapped runs, 58 pages, same `2/58 pages redrawn` delta. The only
rdocx-layout test the relaxation breaks is
`unsafe_pagination_state_falls_back_to_full_layout`, and only on its
`assert!(engine.restart_cache.is_none())` policy assertions — with just those
neutralized its `assert_layout_results_equal(&next, &cold)` passes, so warm
matched cold on its `keep_next` and split-paragraph fixtures.

## Suggested direction

Two things, we think, and the second matters more than the budget number:

1. Make block safety a property of **where a checkpoint may be placed** rather
   than a document-global `all()`. A heading or a three-line paragraph does not
   need to cost the document its restart state; it only needs to not be a
   checkpoint boundary.
2. Consider retaining checkpoints and block fingerprints instead of whole page
   frames. Our 0.8-era implementation stores fingerprints plus checkpoints and
   restarts from the last checkpoint before the changed block, which is why it
   has no byte ceiling to hit. That would also remove the coupling that makes
   the restart budget a leftover of the paragraph cache's 50 MiB.

Measured on Windows 11, release build. Same-build spread on this machine is
about +-30%, so every browser figure above is a median over paired alternating
rounds rather than a single run.

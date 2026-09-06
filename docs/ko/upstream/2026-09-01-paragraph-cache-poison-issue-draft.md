# Issue A — paragraph cache poisoning

**게시됨**: https://github.com/tensorbee/rdocx/issues/65 (2026-09-01)

**Title**

v0.11.1: one footnote disables the paragraph cache for every block after it — 4x relayout on a 700-paragraph document

**Body**

Following up on #53 with a separate mechanism. F-X062 did fix what #53
reported: with a footnote present, restart pagination now stays eligible and
reuses its checkpoint exactly as it does without one. I confirmed that with
tracing before opening this. The remaining cost is in the **paragraph cache**,
not in pagination.

## What happens

`rdocx-layout/src/engine.rs`, in the body-paragraph path:

```rust
if !paragraph_is_cache_safe(paragraph, styles) {
    // Traversal-sensitive content can change generated state consumed
    // by later blocks. The conservative boundary is the first such
    // block, after which no retained block is read in this layout.
    self.paragraph_cache_reads_enabled = false;
```

`paragraph_is_cache_safe` accepts only `RunContent::Text | Tab | Break`, so a
paragraph carrying a footnote reference is not cache-safe. Because the flag is
cleared for the rest of the layout, **one footnote near the top of a document
disables the paragraph cache for every paragraph below it**.

## Workload

700 single-line body paragraphs, 22 pages, one footnote inserted at paragraph
index 10. Each iteration types one character into paragraph 350 and relayouts.
Native, release, `Document::layout()`.

Per-keystroke paragraph cache counters:

| | cache hits | cache builds | `reads_enabled` |
|---|---|---|---|
| no footnote | +699 | +1 | true |
| one footnote | +10 | +689 | false |

Relayout, best of six alternating rounds:

| | no footnote | one footnote |
|---|---|---|
| v0.11.1 | 6 ms | **16–25 ms** |

Headers and footers in the same harness cost nothing (6 ms), which matches
F-X062 having moved those out of the disqualifier set.

## Isolation

Commenting out that single assignment and changing nothing else:

| | one footnote |
|---|---|
| v0.11.1 as shipped | 15–17 ms |
| same build, assignment removed | **4–6 ms** |
| no footnote, for reference | 4–6 ms |

So the whole cliff is that one line. Tracing also shows the restart machinery
behaves identically in both cases — same eligibility flags, checkpoint at block
329 against 330, `paginate` 0.1 ms — so pagination is not involved.

## Why this matters to us

We are a wasm DOCX editor. Documents with footnotes are ordinary, and a note in
an early paragraph makes every keystroke in the rest of the document re-lay out
the whole body. The cost scales with document length, not with anything about
the note.

## Suggested direction

Not "remove the line" — the comment is right that generated state flows
forward, and note numbering is exactly such state. But the same shape you
already adopted for #53 (and for #40/#41 before it) applies: make the
forward-flowing state part of the cache identity rather than a poison. If the
sequence of note references preceding a block is unchanged, the retained block
is still valid. A per-block fingerprint that includes the running note-reference
count would keep the conservatism where it is needed and drop it everywhere
else.

For comparison, our fork's pre-0.9 paragraph cache lays the unsafe paragraph out
fresh and leaves the cache enabled for the others; we have not observed a
correctness problem from that, though our fixture set is narrower than yours.

Measured on Windows 11, release build, bundled fonts.

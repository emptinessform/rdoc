# Issue — F-X073 paginates ordinary prose twice and still never publishes a restart record

**게시됨**: https://github.com/tensorbee/rdocx/issues/67 (2026-09-02)

**Title**

F-X073 (#66 fix): a paragraph that spans a page break makes every layout
paginate twice and never publish a restart record — 2x slower than before the fix

**Body**

Thanks for F-X072 and F-X073 — we re-ran the v0.11.1 migration spike against
`0582da0` with our 31-commit editor stack rebased on top (no conflicts).

**F-X072 is a complete fix.** The footnote cliff from #65 is gone: one unchanged
footnote in a 700-paragraph document costs 22 ms on v0.11.1 and **7.5 ms** with
F-X072, equal to our 0.8-based fork's 7 ms. The paragraph cache now records 174
hits and 1 build per keystroke, exactly as intended.

**F-X073 regresses the case it was meant to fix.** On ordinary prose it is
~2x slower than v0.11.1 was, and the restart record is still never published.

## What happens

`Engine::layout_transaction` runs the recorded pass first, and then:

```rust
if recorded.had_split_paragraph {
    restart_record_eligible = false;
    let (mut pages, outlines) = paginator::paginate_shared_sections(...);
```

`had_split_paragraph` is set by `render_para_split`, i.e. whenever any paragraph
spans a page break. In ordinary prose that is the normal case, not the exception —
a 16-page document of four-line paragraphs has ~15 of them. So on every layout:

1. the recorded pass runs over the whole document,
2. its result is discarded and `paginate_shared_sections` runs over the whole
   document again,
3. `restart_record_eligible` is cleared, so no record is ever published and the
   next keystroke repeats all of the above.

The document can therefore never reach the restart path that F-X073 added, while
paying for the attempt on every keystroke, forever.

## Evidence

175 four-line paragraphs, 16 pages, `Document::layout()`, typing one character
mid-document, best of 10, release build. Phase timers inside
`layout_transaction`:

```
[phase] blocks+notes   1.0 ms   (paragraph cache: hits 174, builds 1)
[phase] eligibility    1.3 ms
[phase] pagination    26.7 ms
[phase] post-pag.     27.7 ms
[diag]  restart_eligible=true  had_split_paragraph=true  restart_cache=0 bytes
```

The same document built from one-line paragraphs never splits, so the recorded
pass survives — it restarts from a checkpoint, relays **one** page and publishes
a 2.3 MB record:

```
[phase] pagination     0.3 ms
[diag]  had_split_paragraph=false  pages=1  candidate bytes=2293536 fits=true
```

## Cost

Four alternating rounds per build, median of per-keystroke minima, ms:

| fixture | 0.8-based fork | v0.11.1 | v0.11.1+F-X072 | `0582da0` |
|---|---|---|---|---|
| 700 four-line paragraphs, `layout()` | 43.5 | 60.5 | 57 | **118** |
| 700 paragraphs via `layout_with_fonts_aliases_and_bundled_fallback` (63 p) | 60 | 87.5 | 86 | **154** |
| 700 paragraphs, one footnote (#65 fixture) | 7 | 22 | 7.5 | 8.5 |

`+F-X072` matches v0.11.1, so the regression is entirely F-X073. It is not
variance: `0582da0` is the slower build in 4/4 paired rounds against
`+F-X072` on both fixtures, and in 6/6 against the 0.8 fork on the first.

In our browser editor, five alternating paired rounds on a 58-page document
(medians, against the 0.8 pin): typing 1.24x, **merge 1.53x (5/5)** and
**undo 1.39x (5/5)**. Typing was already 1.24x on v0.11.1; merge and undo were
at parity there and are new here. Both take the full-relayout fallback, which is
where the second pagination lands.

The trigger is paragraphs that span more than one line, not document size. Same
total line count, different paragraph length:

| fixture | lines | pages | 0.8 fork | `0582da0` |
|---|---|---|---|---|
| 1 line x 700 paragraphs | 700 | 22 | 6-8 | 8-9 |
| **4 lines x 175 paragraphs** | **700** | 16 | 9-11 | **35-38** |
| 4 lines x 1400 paragraphs | 5600 | 122 | 88-99 | 338-406 |

The ratio holds at 3.6-3.9x across sizes. Adding tables or a header/footer does
not change it — the cost does not depend on restart eligibility, only on whether
some paragraph splits.

## What the fix is worth

Keeping the recorded pass and publishing the record (a one-line experiment,
skipping the fallback branch) takes the four-line fixture from 25-28 ms to
**5-6 ms**, below the 0.8-based fork's 11 ms. So the restart machinery does pay
off on exactly these documents once it can engage.

That experiment is not a fix — with the fallback skipped,
`unsafe_pagination_state_falls_back_to_full_layout` fails, so the second pass is
clearly guarding something real. But paying it unconditionally, on every layout,
for every document with a split paragraph, is what makes prose slower than it was
before the fix.

## Reproducer

`Document::new()`, then 175 paragraphs of a body that wraps to four lines at the
default page width, e.g.

```rust
for i in 0..175 {
    doc.add_paragraph(&format!(
        "Paragraph {i}: the quick brown fox jumps over the lazy dog, pack my box \
         with five dozen liquor jugs, and a mixed sentence that keeps going. \
         Sphinx of black quartz, judge my vow across line breaks and pages."
    ));
}
```

`doc.layout()` once, then insert one character into a mid-document paragraph and
`doc.layout()` again, ten times. `had_split_paragraph` is true on every
iteration and `self.restart_cache` stays `None`.

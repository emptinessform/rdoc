# 업스트림 이슈 초안 (2026-08-26) — 캐러 폰트 바이트 비교

- 대상: tensorbee/rdocx, 새 이슈 (#53과 별건 — 그쪽은 각주/재시작 게이트)
- 상태: **게시됨** (2026-08-26, 사용자 승인) — https://github.com/tensorbee/rdocx/issues/54

---

**Title**

`v0.10.1`: `ReusableEngineContext::matches_input` byte-compares caller font
data on every relayout — 22 MB per keystroke in a wasm editor

**Body**

Separate from #53. While chasing the production numbers I mentioned there, I
narrowed the wasm editor's regression to one comparison, and removing it
restores parity with the #40/#41 reference. Reporting it on its own because
the cause turned out to be unrelated to restart pagination.

## What our editor does

Our wasm editor registers five caller font files (~22 MB: two Pretendard,
two NanumMyeongjo, one Malgun Gothic) and calls
`layout_with_fonts_aliases_and_bundled_fallback` on every keystroke, so the
same font bytes are passed in on every relayout.

## Isolation

One-page document, alternating builds inside one browser session (typing mean
/ undo, two passes each):

| configuration | reference | `v0.10.1` |
|---|---|---|
| no caller fonts | 5·6 / 4·6 ms | 7·6 / 8·6 ms |
| 5 caller fonts, 40 aliases | 26·32 / 22·25 ms | 44·67 / 62·77 ms |
| 5 caller fonts, **no aliases** | 25·27 / 31·29 ms | 69·54 / 116·71 ms |

With no caller fonts the two builds are identical. With fonts, `v0.10.1` pays
about 2.5x what the reference pays — and dropping every alias changes nothing,
so this is not F-X051's alias resolution. The document is one page, so it is
a fixed per-relayout cost, not a function of document size.

Natively there is no regression at all. A harness that makes the same call
with the same five fonts, the same aliases and the same 58-page document gives
a median of 62.5 ms for the reference and 56 ms for `v0.10.1`. So the work is
cheap enough to disappear into native memory bandwidth and becomes dominant
under wasm.

## Where it comes from

Both pins copy the bytes into the input (`data.to_vec()` in
`build_layout_input_with_fonts`) and both byte-compare them in
`FontManager::load_additional_fonts`. What `v0.10.1` adds is F-X052's
retained work context. `ReusableEngineContext` holds `fonts` and `images`
outright, and `matches_input` runs, on every relayout:

```rust
&& self.fonts == input.fonts
```

That is a second full pass over the caller's 22 MB per keystroke.

## Confirmation

On a branch I replaced that one line with a family-name and `data.len()`
check — deliberately unsound, purely to measure — and rebuilt. Three wasm
builds alternated inside one session:

One-page document (typing / undo ms):

| build | typing | undo |
|---|---|---|
| reference | 30 · 26 | 23 · 29 |
| `v0.10.1` | 39 · 48 | 54 · 56 |
| `v0.10.1`, shallow compare | **28 · 30** | **26 · 35** |

58-page document:

| build | typing | undo | load |
|---|---|---|---|
| reference | 103 · 86 | 158 · 162 | 6443 · 5503 ms |
| `v0.10.1` | 119 · 107 | 171 · 211 | 5812 · 6585 ms |
| `v0.10.1`, shallow compare | **93 · 82** | **138 · 156** | 5279 · 4722 ms |

The one-line change removes the regression on both documents.

## Suggested fix

Compare an identity rather than the bytes: store a fingerprint of the caller
font set alongside it in `ReusableEngineContext` and compare that, or make
`FontFile.data` an `Arc<Vec<u8>>` so an unchanged set is an O(1) pointer
comparison. The latter also removes the `data.to_vec()` copy in
`build_layout_input_with_fonts`, though it is an API break.

Two related notes:

- `images` sits in the same struct and is compared the same way. Our benchmark
  document has no images, so we did not measure it, but a document with a few
  megabytes of images should hit exactly the same cost.
- `FontManager::load_additional_fonts` byte-compares the same set, and that
  one predates `v0.10.1` — the reference implementation pays it too. Making it
  cheap as well (stacked on the branch above) gave no further typing gain but
  did improve document load consistently: 4135 · 4474 ms against the
  reference's 5932 · 5366 ms. So there may be something to win here for
  everyone, not just a regression to undo.

## Caveats

The patch I measured with is not a correct fix — two different fonts of equal
length would compare equal. It exists only to attribute the cost. All numbers
come from one machine whose consecutive runs of a single build can drift by up
to 2.4x, which is why every comparison above alternates builds inside one
session rather than measuring one build and then the other.

Happy to re-run any of this, or to test a branch.

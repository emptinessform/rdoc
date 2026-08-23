# 업스트림 이슈 초안 (tensorbee/rdocx — 새 이슈)

> 상태: **초안 (미게시)** — 사용자 승인 후 게시. 게시 시 포크 커밋
> 730f372 / 7d821d8 링크를 확인할 것 (svg-poc-0.8).

**Title:** FontFile.family is silently ignored — caller-provided fonts
can't serve document-facing family names

**Body:**

`Document::layout_with_fonts*` and `FontManager::new_with_fonts` accept
`(family_name, bytes)` pairs, and the doc comment reads as if the name
matters ("Each entry is `(family_name, font_bytes)`"). It doesn't:
`load_additional_fonts` only calls `fontdb::Database::load_font_data`,
so a face is ever only known by the family recorded inside the file,
and the caller's `family` label is dead.

The practical consequence shows up as soon as a caller tries to map
open fonts onto the family names real documents ask for. In WASM
(no system fonts) we register open Korean fonts and want e.g. 바탕 /
명조 (serif) to resolve to NanumMyeongjo and 굴림 / 돋움 (sans) to
Pretendard. With the label ignored, every one of those names misses,
falls through `map_font_name` and the generic list, and lands in the
*coverage* fallback — which picks whichever loaded face covers Hangul
first. Serif requests silently render sans; the caller has no way to
express intent.

Minimal repro (no Korean fonts needed, bundled faces only):

```rust
let mut fm = FontManager::new_deterministic()?;
let caladea = /* bundled Caladea regular bytes */;
fm.load_additional_fonts(&[FontFile { family: "바탕".into(), data: caladea }]);
let id = fm.resolve_font(Some("바탕"), false, false)?;
// expected: the Caladea face registered under that label
// actual:   Carlito (first generic fallback)
```

Reference implementation on our fork (svg-poc-0.8), two review-sized
commits:

1. `730f372` — remember requested-name → real-family aliases for
   caller fonts and try the alias in `resolve_font` right after the
   exact name (before `map_font_name` and generics). A label equal to
   the face's own family stores nothing, so existing callers are
   unaffected. Unit test included (the repro above).
2. `7d821d8` — make aliases byte-free. Expressing the mapping by
   repeating `FontFile` entries duplicates the font bytes per alias;
   with a realistic Korean alias set (~40 names over 2 fonts) that is
   ~100MB cloned into `LayoutInput` per relayout — our editor keystroke
   went 70ms → ~276ms before we caught it. Added
   `FontManager::set_caller_aliases(&[(String, String)])` (unchanged
   set = no-op, changed set invalidates resolution state),
   `Engine::set_caller_font_aliases`, and
   `Document::layout_with_fonts_aliases_and_bundled_fallback`, folded
   into the existing `fonts_changed` cache boundary.

Both are running in production in our editor (the rdoc online demo
ships Pretendard + NanumMyeongjo this way). Happy to send either or
both as a PR against your preferred base — the alias table is
engine-level and looks orthogonal to the S52/S53 work.

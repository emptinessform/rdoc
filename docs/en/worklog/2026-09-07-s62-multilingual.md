# 2026-09-07 — S62: naming cleanup and a bilingual docs structure

Started from the two things the upstream maintainer left on #67 ("I will look
at this #67 this week" and "are you planning an English version of doc as
well?").

## 0. Upstream response (#67)

The maintainer's comment (2026-09-06 18:16) offered to re-examine #67, which
their own v0.12.0 had already fixed. Checking the actual GitHub state: #65 and
#66 are CLOSED, **#67 is still OPEN**, and #69 has no response yet. With the
user's approval we
[commented on #67](https://github.com/tensorbee/rdocx/issues/67#issuecomment-5560088609):
the evidence that F-X075 closes it (the restart record publishes and is
reused; typing ~2.4x faster), a pointer that #69 is the live issue, and a
summary of the three S61 fixes. To the English-version question the answer is
that both the docs and the product go bilingual.

## 1. Naming — removing "poc" from the present tense

The binary that carried the name `poc` is not an editor: it lays a DOCX out
with system fonts and writes SVG, reference PNGs and `hits.json` into `out/`.
So we split the name three ways (decisions D6):

| Place | Before | After |
|---|---|---|
| Native binary | `--bin poc` | `--bin render` |
| Web package | `rdoc-web` | `rdoc-editor` |
| Product name | mixed | **rdoc editor** (already the demo's `<title>`) |
| PDF output | `out/poc.pdf` | `out/render.pdf` |
| Fork branch | `svg-poc-0.12` | kept (upstream issues name it) |

"PoC" was also removed from prose: comments in `lib.rs`, `main.rs` and
`repro.rs`; the demo document's heading (`"rdocx SVG Rendering PoC"` →
`"rdocx SVG rendering demo"`) and its last line (`"— end of PoC page —"` →
`"— end of demo page —"`); "PoC 1-3" in the roadmap became "Prototype 1-3";
and the title of knowledge section 13. "PoC" in past worklogs stays — those
are records.

### Verification

Artifact hashes were taken before the rename and compared after.

```
before: page-1.svg 609c5754  page-2.svg 95e45ad7  hits.json 6a8430aa
after : page-1.svg c53f03f7  page-2.svg 95e45ad7  hits.json 6195b0ea
```

`page-2.svg` is **byte-identical**; only page-1 (which carries the demo
wording) and the hits that hold its coordinates moved — the render path itself
was untouched. Hit count stayed at 272. `cargo test -p rdoc-core` 9/9 passed,
and `npm run build` (tsc) passed.

## 2. Docs — docs/ko and docs/en mirrors

User's decision: mirrored trees, retroactive translation limited to the
durable documents (decisions D6).

```
docs/
  ko/   01-roadmap.md  decisions.md  knowledge.html  worklog/  upstream/
  en/   01-roadmap.md  decisions.md  knowledge.html  worklog/
  evidence/            (screenshots — language neutral)
```

Existing files moved with `git mv` (relative links between worklogs still
resolve, since they stay in one directory), and 11 inbound links in README,
CLAUDE.md and an upstream draft were updated. CLAUDE.md gained a
"multilingual rules" section: new documents go in both trees, UI strings live
only in `web/src/i18n/`, upstream postings stay in English.

Three English documents were written: `decisions.md` (D1-D6), `01-roadmap.md`,
and `knowledge.html` (13 sections, 19,000 characters — including the text
inside the inline SVG figures; only the body font stack was changed to system
fonts). A script checked that both files carry all 13 sections, close their
DOCTYPE and `</html>`, and have balanced block tags.

## 3. README corrections

Stale claims replaced with measured ones.

| Item | Before | After |
|---|---|---|
| Fork branch | svg-poc-0.8 (v0.8.0) | svg-poc-0.12 (v0.12.0) |
| wasm size | 10.9MB (5.0MB gzipped) | 17.5MB (8.9MB gzipped) |
| Browser suites | 34 | 50 |
| Typing | min 23ms | min 12ms |
| Upstream issue list | #40-#44 (planned v0.9.0) | #65-#69, current |
| Status date | 2026-08-23 | 2026-09-07 |

The wasm size was measured directly: `web/pkg/rdoc_core_bg.wasm` is
17,535,635 bytes, 8.9MB under gzip -6.

## 4. Browser gate

The demo document's strings changed, so wasm was rebuilt (17,535,635 →
17,539,356 bytes, +3,721) and the battery run after a `browse restart`.

```
TOTAL: 50 PASS, 0 FAIL
```

That means the wording change did not disturb the hit path — the tests obtain
coordinates at runtime through `hitFor(path)`, so they follow along when glyph
widths change. Only a stale comment in `ux4-test.js` ("— end of PoC page —")
needed updating to the new wording.

## Remaining

- **S63**: product UI i18n (`web/src/i18n/`; 127 lines in index.html plus 60
  in TypeScript).
- The fork branch will be renamed at the next upstream migration.
- The 77 past worklogs stay Korean-only (D6).

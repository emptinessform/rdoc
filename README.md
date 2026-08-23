# rdoc

**[한국어](#한국어)** · **[English](#english)**

**[온라인 데모 / Live demo →](https://emptinessform.github.io/rdoc/)**

---

## 한국어

**서버 없이 브라우저에서 도는 경량 Rust/wasm DOCX 뷰어·에디터**

[rhwp](https://github.com/edwardkim/rhwp)("모두의 한글")가 HWP에서 증명한 것을
DOCX에서 재현하는 프로젝트입니다. 차이점: DOCX는 파서·레이아웃 엔진이
오픈소스 [rdocx](https://github.com/tensorbee/rdocx)로 이미 존재하므로,
이 프로젝트는 **그 위에 브라우저 렌더러와 에디터 계층을 쌓는 것**에 집중합니다.

### 왜

- 기존 브라우저 DOCX 편집기는 서버가 필요하거나(OnlyOffice, Collabora),
  wasm이어도 거대합니다(ZetaOffice ~1GB). 이 프로젝트의 wasm은 현재
  **10.9MB (gzip 5.0MB)** 입니다.
- 결과물 SVG는 글리프가 벡터 패스로 내장된 자기완결 문서 —
  뷰어에 폰트가 없어도 동일하게 렌더링됩니다 (1페이지 gzip ~40KB).
- 한국어 조판(폰트 폴백·셰이핑)을 1급 요구사항으로 다룹니다. 데모는
  오픈 폰트(Pretendard·나눔명조, SIL OFL)를 굴림·돋움·바탕·궁서 등
  상용 패밀리명에 매핑해 어떤 환경에서도 한국어가 제 부류의 폰트로
  조판됩니다.

### 현재 상태 (2026-08-23)

메뉴바·툴바를 갖춘 편집기가 [온라인 데모](https://emptinessform.github.io/rdoc/)로
공개되어 있습니다 (개발 프리뷰, main 푸시마다 자동 배포):

- **편집**: 6개 스토리 전부(본문·표 셀·머리글·꼬리글·각주·미주) 타이핑,
  한글 IME(조합 = undo 1단위), Enter/병합, 각주·미주 삽입/삭제
- **선택 편집 (Word 의미론)**: 같은 문단 / 여러 문단 / 셀 간 / 표를
  가로지르는 선택의 삭제·치환, 선택에 덮인 노트는 노트째 삭제
- **클립보드**: 복사·잘라내기·붙여넣기(멀티라인 = 문단 분할, undo 1회),
  클립보드 이미지 붙여넣기
- **찾기/바꾸기**: Ctrl+F/H, 전 스토리, 모두 바꾸기 = undo 1회
- **서식**: B/I/U(실물 볼드 + CJK 합성 이탤릭)·글꼴·크기·색·문단
  정렬·문단 스타일 — 임의 선택 모양에서 각각 undo 1회, 툴바가 캐럿
  위치의 서식을 실시간 표시
- **표 구조**: 행/열 추가·삭제 (서식 상속, tblGrid 동기), Tab 셀 탐색
- **이미지**: 인라인 삽입(파일/클립보드)·선택·삭제, EMF 도장 등
  실문서 이미지
- **뷰어**: 페이지 썸네일, 지연 페이지 렌더(가시 페이지 우선),
  .docx 저장/열기 왕복

**성능** (63페이지 문서): 키 입력당 네이티브 min 23ms(게이트 <30ms),
브라우저 데모 문서 기준 20~25ms · 변경 페이지만 재렌더.

코드는 [`crates/rdoc-core/`](crates/rdoc-core/)(Rust 코어)와
[`web/`](web/)(TypeScript 앱), 브라우저 테스트 스위트 34종은
[`web/tests/`](web/tests/), 상세 기록은 [`docs/worklog/`](docs/worklog/),
과정에서 나온 지식 정리는 [`docs/knowledge.html`](docs/knowledge.html)에
있습니다.

### 실행

```bash
# 구조: crates/rdoc-core (렌더·편집 코어) + web/ (에디터 앱). 루트에서 실행.
# 네이티브 (시스템 폰트 사용): out/에 SVG + 참조 PNG 생성
cargo run --release -p rdoc-core --bin poc

# wasm 에디터
wasm-pack build crates/rdoc-core --release --target web --out-dir ../../web/pkg -- --no-default-features
cd web && npm install && npm run build   # TypeScript → web/js/
python -m http.server 8741               # → http://localhost:8741
# 한국어 폰트: web/fonts/에 오픈 폰트(Pretendard 등)를 두거나
# web/malgun.ttf 로컬 복사 (MS 라이선스 — 저장소에 포함하지 않음)
```

### 업스트림 관계

제안 다수가 rdocx **v0.8.0**에 수용·크레딧됐고(F-X032 layout API,
F-X037 소스 맵, F-X038 문단 캐시), 현재는 v0.8.0 위에 리뷰 경계별 커밋을
쌓은 [포크 브랜치 svg-poc-0.8](https://github.com/emptinessform/rdocx/tree/svg-poc-0.8)을
rev 고정으로 의존합니다:

- 성능 제안 [#40](https://github.com/tensorbee/rdocx/pull/40)·[#41](https://github.com/tensorbee/rdocx/pull/41)
  — 업스트림이 F-X039/40/43~47 강화판으로 수용(S52, v0.9.0 예정)
- [#42](https://github.com/tensorbee/rdocx/issues/42)·[#43](https://github.com/tensorbee/rdocx/pull/43)
  — 밀집 서식 레이아웃 수정 7건 → S53 **F-X048**로 편성, v0.9.0 크레딧 예정
- [#44](https://github.com/tensorbee/rdocx/issues/44) — 폰트 별칭
  (FontFile.family 무시 버그) 보고 + 참조 구현, 응답 대기
- [#23](https://github.com/tensorbee/rdocx/issues/23) — 글리프 중복 진단
  → F-X041로 수정·종결

### 로드맵 · 진행 방식

PoC 단계(뷰어 → 편집 MVP → 증분 레이아웃/IME → 실문서 검증)는 완료 —
현재는 본격 구현 단계([`docs/01-roadmap.md`](docs/01-roadmap.md)):
M0 제품 골격(완료) → **M1 에디터 완성도(진행 중)** → M2 문서 기능 →
M3 제품화.

rhwp의 방법론을 따릅니다: AI 페어 프로그래밍 + **사람이 매 단계를
확인하는 검증 우선 진행**. 모든 단계는 실측 증거(수치·스크린샷)와 함께
`docs/worklog/`에 기록됩니다. 규칙은 [`CLAUDE.md`](CLAUDE.md).

### 라이선스

MIT OR Apache-2.0 (rdocx 생태계와 동일)

---

## English

**A lightweight Rust/wasm DOCX viewer & editor that runs entirely in the
browser — no server.**

This project reproduces for DOCX what
[rhwp](https://github.com/edwardkim/rhwp) proved for Korea's HWP format.
The difference: DOCX already has an open-source parser and layout engine,
[rdocx](https://github.com/tensorbee/rdocx), so rdoc focuses on
**building the browser renderer and editor layer on top of it**.

### Why

- Existing browser DOCX editors need a server (OnlyOffice, Collabora) or
  are enormous even as wasm (ZetaOffice ~1GB). rdoc's wasm is currently
  **10.9MB (5.0MB gzipped)**.
- The output SVG is self-contained, with every glyph embedded as a vector
  path — it renders identically on machines with no fonts installed
  (~40KB gzipped per page).
- Korean typography (font fallback, shaping) is a first-class
  requirement. The demo maps open fonts (Pretendard, NanumMyeongjo — SIL
  OFL) onto the family names real documents ask for (굴림, 돋움, 바탕,
  궁서, …), so Korean text shapes with the right class of font anywhere.

### Status (2026-08-23)

An editor with a menubar and toolbar is publicly available as a
[live demo](https://emptinessform.github.io/rdoc/) (dev preview,
auto-deployed on every push to main):

- **Editing**: typing in all six stories (body, table cells, headers,
  footers, footnotes, endnotes), Korean IME (one composition = one undo),
  Enter/merge, footnote & endnote insert/delete
- **Selection editing (Word semantics)**: delete/replace across same
  paragraph, sibling paragraphs, table cells, and table-spanning
  selections; notes covered by a selection are deleted with their markers
- **Clipboard**: copy, cut, paste (multi-line = paragraph splits as one
  undo), image paste
- **Find/replace**: Ctrl+F/H across all stories; replace-all is one undo
- **Formatting**: B/I/U (real bold faces plus synthetic CJK italic), font
  family, size, color, paragraph alignment and styles — one undo from any
  selection shape, with live toolbar state at the caret
- **Table structure**: add/remove rows and columns (format inheritance,
  tblGrid kept in sync), Word-style Tab cell navigation
- **Images**: inline insert (file/clipboard), click-select, delete;
  handles real-world documents (EMF stamps etc.)
- **Viewer**: page thumbnails, lazy page rendering (visible pages first),
  .docx save/open round-trip

**Performance** (63-page document): native min 23ms per keystroke
(<30ms gate); the browser demo document edits at 20–25ms, re-rendering
only changed pages.

Code lives in [`crates/rdoc-core/`](crates/rdoc-core/) (Rust core) and
[`web/`](web/) (TypeScript app); the 34 browser test suites are in
[`web/tests/`](web/tests/); detailed logs in
[`docs/worklog/`](docs/worklog/) (Korean).

### Running

```bash
# Layout: crates/rdoc-core (render/edit core) + web/ (editor app). Run from the root.
# Native (system fonts): writes SVG + reference PNGs to out/
cargo run --release -p rdoc-core --bin poc

# wasm editor
wasm-pack build crates/rdoc-core --release --target web --out-dir ../../web/pkg -- --no-default-features
cd web && npm install && npm run build   # TypeScript → web/js/
python -m http.server 8741               # → http://localhost:8741
# Korean fonts: put open fonts (e.g. Pretendard) under web/fonts/, or copy
# a local malgun.ttf (MS-licensed — never committed to the repo)
```

### Upstream

Many proposals were accepted and credited in rdocx **v0.8.0** (F-X032
layout API, F-X037 source maps, F-X038 paragraph cache). rdoc currently
pins a [fork branch svg-poc-0.8](https://github.com/emptinessform/rdocx/tree/svg-poc-0.8)
of review-sized commits on top of v0.8.0:

- Performance PRs [#40](https://github.com/tensorbee/rdocx/pull/40)·[#41](https://github.com/tensorbee/rdocx/pull/41)
  — adopted upstream as hardened F-X039/40/43–47 (S52, planned v0.9.0)
- [#42](https://github.com/tensorbee/rdocx/issues/42)·[#43](https://github.com/tensorbee/rdocx/pull/43)
  — seven dense-form layout fixes, scheduled as S53 **F-X048** with
  credit in v0.9.0
- [#44](https://github.com/tensorbee/rdocx/issues/44) — font aliasing
  (FontFile.family ignored) report + reference implementation, awaiting
  response
- [#23](https://github.com/tensorbee/rdocx/issues/23) — glyph
  duplication diagnosis → fixed as F-X041, closed

### Roadmap · Process

The PoC phase (viewer → editing MVP → incremental layout/IME →
real-document validation) is complete; now building the product
([`docs/01-roadmap.md`](docs/01-roadmap.md)): M0 product skeleton (done)
→ **M1 editor completeness (in progress)** → M2 document features →
M3 productization.

rdoc follows rhwp's methodology: AI pair programming with
**measurement-first progress confirmed by a human at every stage**.
Every stage is logged with evidence (numbers, screenshots) in
[`docs/worklog/`](docs/worklog/). Rules: [`CLAUDE.md`](CLAUDE.md).

### License

MIT OR Apache-2.0 (same as the rdocx ecosystem)

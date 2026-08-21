# rdocx-svg-poc

rdocx 레이아웃 출력(`oxml_layout::LayoutResult`)을 **SVG로 렌더링하는 백엔드 PoC**.

DOCX → (rdocx 파서/문서모델) → (rdocx-layout: harfrust 셰이핑 + 줄바꿈 + 페이지네이션)
→ **positioned PageFrame** → SVG. 글리프는 폰트의 원본 TTF 바이트에서
ttf-parser로 아웃라인을 추출해 `<defs>`의 `<path>`로 중복 제거해 내장하고
`<use>`로 배치한다. 결과 SVG는 **뷰어에 폰트가 없어도 동일하게 보이는
자기완결 벡터 문서**다.

## 실행

```
cargo run --release
```

`out/`에 생성: `demo.docx`(rdocx API로 생성한 데모 문서), `page-N.svg`(PoC 출력),
`page-N.ref.png`(rdocx 자체 PNG 백엔드 레퍼런스), `index.html`(좌우 비교 뷰어).

## 의존성 주의

`Cargo.toml`이 로컬에 클론한 rdocx 저장소를 path 의존으로 가리킨다.
클론에는 패치 1개가 필요하다 (crates.io 0.7.0에는 없는 API):

```rust
// crates/rdocx/src/document.rs — Document impl에 추가
pub fn layout(&self) -> Result<Arc<oxml_layout::LayoutResult>> {
    self.cached_layout()
}
```

업스트림 rdocx는 `layout_page()`(페이지만, 폰트 없음)만 공개하고 전체
`LayoutResult`(폰트 바이트 포함)는 PDF/PNG 백엔드 내부에서만 쓴다.
외부 렌더러/에디터 계층을 만들려면 이 공개 API가 필요하다 —
**업스트림 기여 후보 #1.**

## 요소 매핑

| 레이아웃 출력 | SVG |
|---|---|
| `GlyphRun` (glyph id + advance) | `<defs><path>` 글리프 아웃라인 + `<use translate·scale>` |
| `Line` (테두리/밑줄/취소선) | `<line>` (dash 패턴 포함) |
| `FilledRect` (음영/하이라이트) | `<rect>` |
| `Image` | `<image href="data:...">` |
| `Path` (도형) | `<path>` (fill-rule 포함) |
| `Group` (transform/opacity) | `<g transform="matrix(...)">` |

PoC에서 생략(경고 카운트만): 그라디언트(첫 stop 색으로 폴백), 클립 패스, 그룹 효과.

## 검증 결과 (2026-08-21)

- 데모 1페이지: 제목, bold/italic/색/취소선/크기 혼합 런, **한국어 문단(Malgun
  Gothic 폴백 셰이핑)**, 불릿 목록, 테두리+헤더 음영 표, 가운데 정렬 문단.
- 헤드리스 브라우저 스크린샷과 rdocx PNG 레퍼런스가 시각적으로 일치.
- 크기: SVG 140KB, **gzip 40KB** (글리프 143개 dedup, `<use>` 559개).

### 발견한 문제

1. **좌표 정밀도**: scale 값(예: 16pt/2048upem=0.0078)을 소수 2자리로 자르면
   글리프가 ~28% 커진다. scale은 7자리 정밀도 필요 (`fs()`).
2. **업스트림 버그 — 글리프 중복**: "and"→"aand", "ttf-parser"→"ttf-pparser"로
   렌더링됨. docx 원본 텍스트는 정상이고 SVG와 rdocx 자체 PNG 백엔드 양쪽에
   동일하게 나타나므로 rdocx-layout의 셰이핑/세그먼트 경계 버그. 업스트림
   보고 후보.

## 2단계: wasm PoC (2026-08-21)

`src/lib.rs`(공유 렌더러) + `src/wasm.rs`(`SvgConverter` 바인딩) 구조로 재편,
`wasm-pack build --release --target web --out-dir web/pkg -- --no-default-features`.

- **브라우저 안에서 docx 생성→레이아웃→SVG가 동작**: 데모 문서 92.6ms,
  .docx 파일 파싱 포함 36.6ms (2회차, warm).
- wasm 크기: **10.4MB raw / 4.8MB gzip** (번들 폰트 포함; ZetaOffice ~1GB 대비).
- 시스템 폰트가 없으므로 페이지가 `fetch`한 폰트를 `add_font(family, bytes)`로
  주입 — rdocx의 해석 순서(사용자 폰트 → 문서 내장 → 번들)에 그대로 편입됨.
  데모는 Malgun Gothic을 주입해 한국어 셰이핑 확인.
- 데모 실행: `python -m http.server 8741` (web/에서) → http://localhost:8741
  "Render built-in demo" 버튼 또는 .docx 파일 열기.

업스트림 클론에 필요한 패치는 `upstream/layout-accessor.patch`
(`layout()` + `layout_with_fonts()`).

## 업스트림 게시 (2026-08-21)

- 글리프 중복 버그: 메인테이너가 이미 등록한
  [#23](https://github.com/tensorbee/rdocx/issues/23)에 진단 코멘트 게시 —
  중복 지점이 전부 "실제 줄바꿈되지 않은 UAX #14 줄바꿈 후보"라는 상관관계,
  최소 재현 코드(`examples/repro.rs`), 외부 렌더러에서도 동일 재현(레이아웃
  출력 자체에 존재) 확인.
- 공개 레이아웃 API 제안:
  [#37](https://github.com/tensorbee/rdocx/issues/37) 신규 등록 —
  `layout()` / `layout_with_fonts()`, PR 제출 의사 포함.

## 3단계: 히트테스팅/편집 PoC (2026-08-21)

클릭 → 커서 → 타이핑 → 재조판의 최소 에디터 루프를 브라우저에서 검증.

**구조:**
- 렌더러가 각 `GlyphRun`에 `data-hit` ID를 달고 히트맵(JSON)을 병행 출력:
  좌표(baseline x/y), 폰트 크기, **문자 단위 advance**(리가처는 균등 분배로
  근사), 원문 텍스트, 그리고 문서 위치(`para`/`start`).
- 문서 위치는 업스트림 레이아웃에 provenance가 없어 **순차 텍스트 매칭**으로
  역산 (`map_hits_to_doc`): 본문 문단 기준 156/174 세그먼트 매핑 성공.
  미매핑 18개 = 불릿 마커 + 표 셀 (설계상 한계 — 편집 불가로 표시됨).
- 편집: `insert_at`/`delete_char_before`가 문단 텍스트를 런 경계 보존하며
  수정 → wasm `SvgConverter.insert/delete`가 재레이아웃 후 새 SVG 반환.
- JS: SVG 좌표 히트테스트(세로 밴드 우선 스코어), 캐럿(`<line>` 블링크),
  keydown 타이핑/Backspace/화살표, `window.__t` 테스트 훅.

**측정 결과 (헤드리스 브라우저 자동화 검증):**
- 제목 중간 클릭 → para 0 offset 8, "XYZ" 삽입 → "rdocx SVXYZG…" 정확,
  백스페이스 3회 원복. **키 입력당 21~27ms** (wasm 전체 재레이아웃 +
  재렌더 + DOM 교체 포함).
- 한국어 문단 클릭 → 삽입 → 줄바꿈 재계산까지 정상 (22ms).
- 표 셀 클릭 → "no document mapping (needs upstream provenance)" 안내.

**확인된 한계 (에디터 본작업의 요구사항):**
1. 표 셀·리스트 마커는 텍스트 매칭으로 도달 불가 → 업스트림 provenance
   (관문 1)의 정량적 근거. 매칭 자체도 동일 문구 반복 문서에서 깨질 수 있음.
2. 한국어는 세그먼트가 음절 단위로 잘게 나뉨 → 1글자 조각 매칭 규칙 필요했음.
3. IME 조합 입력 미처리 (완성 음절 삽입만 검증) — composition 이벤트 처리가
   다음 과제.
4. 키 입력당 전체 재레이아웃 21~27ms: 1페이지 문서는 충분, 대형 문서는
   증분 레이아웃(관문 2) 필요 — 이제 실측 기준선이 생김.

## 다음 단계 (에디터 계층으로)

이 PoC가 증명한 것: rdocx의 레이아웃 출력은 브라우저 렌더러를 얹기에 충분히
구조화되어 있다. 에디터로 가려면 추가로 필요한 것:

- wasm에서 이 SVG 생성 경로 실행 (rdocx-wasm 확장) 또는 DOM 직접 조작
- 글리프 `<use>`에 문자 인덱스 매핑 부착 → 클릭→커서 위치 변환 (hit testing)
- 증분 리레이아웃 (현재는 문서 전체 재계산; 문단 단위 캐시 필요)
- IME 조합 입력 처리 (한글 입력의 핵심 난제)

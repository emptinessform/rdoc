# rdoc 프로젝트 진행 규칙

경량 Rust/wasm DOCX 뷰어·에디터. rhwp의 방법론(AI 페어 프로그래밍 + 검증
우선 + 투명한 기록)을 따른다.

## 단계적 진행 (핵심 규칙)

1. **단계 시작 전**: 이번 단계의 목표·범위·검증 기준을 짧게 제시한다.
2. **구현**: 범위를 벗어나는 확장은 하지 않는다. 발견한 문제는 기록하고
   범위에 넣을지 사용자에게 묻는다.
3. **검증**: 주장하지 말고 실측한다 — 네이티브는 실행 출력, 브라우저는
   헤드리스 스크린샷/타이밍. 실패·한계도 그대로 기록한다.
4. **기록**: `docs/ko/worklog/YYYY-MM-DD.md`에 무엇을 했고 어떻게 검증했는지
   증거(수치, 스크린샷 경로, 커밋)와 함께 남긴다. 중요한 설계 선택은
   `docs/ko/decisions.md`에 추가한다. 영문본은 아래 다국어 규칙을 따른다.
5. **확인 게이트**: 단계가 끝나면 결과를 보고하고 **사용자 확인을 받은 뒤**
   다음 단계로 넘어간다. 확인 없이 다음 단계를 시작하지 않는다.

## 다국어 규칙 (2026-09-07~)

프로젝트는 한국어·영어 2본으로 간다. 제품 이름은 **rdoc editor**이고
"PoC"는 현재형 표현으로 쓰지 않는다 (지난 워크로그의 기록은 그대로 둔다).

- **문서**: `docs/ko/`와 `docs/en/`의 미러 트리. 새 문서는 **두 곳 모두**에
  같은 파일명으로 만든다. 언어 중립 자산은 `docs/evidence/`(스크린샷).
  소급 영문화는 지속 문서(README·decisions·01-roadmap·knowledge)까지만이며
  과거 워크로그는 한국어 원본만 남긴다.
- **제품**: UI 문자열은 `web/src/i18n/`의 로케일 테이블로만 쓴다. 소스에
  한글 리터럴을 새로 넣지 않는다 (주석 제외).
- **업스트림 게시**: 영어로 쓴다 (기존과 동일).

## 빌드·검증 명령

```bash
# 워크스페이스 루트에서 실행. 구조: crates/rdoc-core (코어) + web/ (앱)
# 네이티브 (시스템 폰트): out/에 SVG + 참조 PNG + hits.json
cargo run --release -p rdoc-core --bin render

# wasm 빌드
wasm-pack build crates/rdoc-core --release --target web --out-dir ../../web/pkg -- --no-default-features

# 웹 앱 빌드: 소스는 web/src/*.ts (TypeScript), web/js/는 tsc 산출물
cd web && npm install && npm run build   # tsc -p .

# 웹 데모 서버 (web/에서): 한국어 폰트를 web/malgun.ttf로 먼저 복사
python serve.py   # http.server 8741 + no-cache (모듈 캐시 방지)
# ⚠ wasm/pkg 재빌드 후에는 browse restart (렌더러 메모리 캐시)

# 브라우저 테스트 스위트: web/tests/ (실행 규약은 web/tests/README.md)
```

브라우저 검증은 헤드리스 브라우저(browse 스킬)로 자동화한다.
페이지의 `window.__t` 훅: `clickAt(page,x,y)`, `type(s)`, `backspace()`,
`state()`. 좌표는 SVG viewBox 좌표(pt)이며 `out/hits.json`에서 얻는다.

## 업스트림 관계 (tensorbee/rdocx)

- 기반: 업스트림 **v0.12.0** (2026-09-06 S59/S60에서 v0.8.0에서 이행).
- 의존: 포크 `emptinessform/rdocx` 브랜치 `svg-poc-0.12` (rev `c8315b92`
  고정, Cargo.toml; 로컬 클론 D:\sb\SBDoc\rdocx-fork). v0.12.0 위 **40커밋**
  (v0.8.0 위 50커밋에서 18개를 업스트림이 흡수해 드롭, 신규 8개 추가):
  S2 편집 헬퍼, 미주 타입 필드 승격·노트/표/이미지 편집 API, 리스트/링크/
  셀 병합/그리드 게터/본문 항목 이동(move_content)/이미지 리사이즈
  (resize_inline_image), "font-natural" 라인 규칙과 한글 어절 줄바꿈,
  합성 이탤릭, 후행 공백 행잉, 탭 스톱 파라미터화, 그리고 번들 폴백 엔진
  핸드오프(`take_layout_engine`/`set_layout_engine`), 그리고 노트 파트
  캐시 게이트의 문단 단위 축소·재시작 identity 메모이즈·provenance에서의
  재시작 허용(S61).
  SBOdf도 같은 브랜치에 커밋한다.
  ⚠ 어절 줄바꿈은 **라인브레이커의 `LineBreakParams::hangul_word_wrap`
  하나로만** 구현한다. v0.8.0의 `convert::text_segments` 프리스플릿은
  v0.12.0이 없앴고, 되살리면 업스트림 계약 테스트 2개
  (`word_projection_leaves_break_segmentation_to_shared_layout`,
  `reported_words_do_not_duplicate_boundary_glyphs`)가 깨진다.
  구 브랜치 `svg-poc-0.8`(v0.8.0 핀), `svg-poc`(pre-0.8.0), `perf-caches`,
  스파이크 브랜치들(`svg-poc-0.9`~`svg-poc-0.11-s63`)은 참고용 유산.
  진단용: `exp/s60-identity`(`RDOCX_DIAG_IDENTITY`로 레이아웃당
  `restart_body_identity` 호출 수 집계).
- 업스트림 상태 (2026-09-06): **v0.12.0으로 이행 완료** (다섯 번의 스파이크
  끝에). v0.12.0 태그 `19adaacf`(2026-09-03, S64). #65/#66/#67 모두 종결이며
  #67은 **F-X075**가 고쳤다 — S58이 짚은 `Engine::layout_transaction`의
  `had_split_paragraph` 거부 분기를 제거하고 안전성은
  `Pager::finish_page_before`의 완전 블록 경계 체크포인트로 좁혔다.
  업스트림 main은 이미 S68(`c8908d07`)까지 갔으나 태그본만 채택했다.
  **이행으로 얻은 것**: 네이티브 타이핑 700문단 min ms 31/34/33/27 →
  **12/14/14/17**(4/4 승, ~2.4배). S57·S58의 타이핑 1.24× 회귀 해소,
  S58의 병합 1.53×·undo 1.39×·로드 1.54× 회귀 모두 동률로 소멸.
  콜드 레이아웃 3/3 승. 포크 50 → 36커밋.
  **이행에 필요했던 rdoc 적응**: (1) 호출부 3곳 이름
  (`layout_with_fonts_aliases_and_bundled_fallback_and_options`),
  (2) `PositionedElement::MarkedContent` — v0.12.0이 모든 요소를 태그드
  구조 컨테이너로 감싸므로 `emit_elements`/`collect_hits`/`hash_elements`가
  children으로 내려가야 한다(안 하면 전 페이지가 215바이트 빈 SVG),
  (3) `PositionedElement::MultilingualText` — 문단 base direction이 `Auto`가
  아니거나 런에 CJK 표의문자(**한자 포함**)·가나·태국어·데바나가리·히브리/
  아랍이 있으면 `MultilingualGlyphRun`으로 나온다(**한글은 트리거 아님**).
  `legacy_projection()`이 `GlyphRun`과 글리프 단위로 동일하므로 히트는
  `push_hit` 그대로 쓰고, 렌더는 글리프별 x/y 오프셋과 세로 어드밴스를
  받는 공용 페인터로 처리한다 — 글리프는 `(pen_x + x_offset,
  pen_y - y_offset)`, 펜은 `(+x_advance, -y_advance)`.
  **남은 회귀와 그 처리 (이슈 #69, 2026-09-06 게시·정정; #67에는 확인
  코멘트)**: 구조 편집이 v0.8보다 느리다. **원인은 두 개이며 S60의 진단
  (레코드 재구축)은 틀렸다** — 레코드는 190 ms 중 3 ms다. 구간 분해
  (715블록, ms/레이아웃, `exp/s60-identity`·`exp/s61-v08-phases`):
  타이핑 블록 29–37 → 6–8 / 페이지네이션 1.0 → 3.3–5.4,
  Enter 블록 38–53 → 2.8–3.6 / **페이지네이션 20–25 → 52–60**,
  각주 삽입 **블록 25–29 → 123–183** / 페이지네이션 13–15 → 50–59.
  (1) **각주**: `RetainedLayoutContext`에 노트 파트 동일성이 들어 있어
  노트가 바뀌면 `paragraph_cache_reads_enabled`가 문서 전체에서 꺼졌다
  (`hits=0 builds=698`). → **S61에서 포크가 문단 단위로 좁혀 해결**:
  `notes_match`를 분리하고, 노트 참조가 있는 문단만 무효화한다. 재시작
  레코드와 머리글/꼬리글 캐시는 엄격한 전체 게이트를 유지
  (`retained_context_matches_full`). 업스트림 테스트의 warm/fresh 동등성은
  그대로 통과하고 캐시 카운트 기대치만 갱신했다. 결과(5라운드 교대 min ms):
  각주 삽입 181 → **73**(5/5 승), 삭제 179 → **72**(5/5 승) — v0.8 대비
  회귀가 3.4×/3.9× → **1.4×/1.6×**. 타이핑은 변화 없음.
  (2) **Enter/병합/선택삭제**: 캐시는 멀쩡하고(`hits=702 builds=1`) 비용은
  페이지네이션이었다. `reusable_restart_record`가 provenance일 때 본문 블록
  수 동일성을 요구해 재시작 레코드를 통째로 못 썼다. → **S61c에서 해결**:
  prefix 재시작은 허용하고(첫 변경 블록 앞 인덱스는 안 움직인다),
  `tail_source`만 막았다 — `WordSourcePath`가 본문 인덱스 기반이라 삽입 시
  뒤쪽 소스 노드가 밀리므로 꼬리 페이지 재사용은 stale 스팬을 남긴다.
  Enter 77/63/49/40 → **16/18/18/19 ms**(4/4 승, v0.8 대비 ~3배),
  병합 64/61/49/41 → **18/21/20/17**. 브라우저 Enter 중앙값 316 → 127 ms.
  회귀 테스트 `sourced_insert_and_delete_restart_instead_of_repaginating`
  (재계산 ≤3페이지 + 소스 스팬 포함 fresh 동등).
  (3) **빠른 경로의 identity 직렬화**: 세 스캔이 같은 블록을 각각 다시
  직렬화해 레이아웃당 ~1.5N회(3 ms)였다. → S61에서 `BodyIdentities` 메모로
  블록당 1회(**1072 → 715**)로 줄였다. 타이핑 min 15 → **12 ms**,
  mean 17 → 14 ms (6/6 승). 비교 대상은 불변(지문 프리필터 + identity
  authority).
  기능 등가: 브라우저 배터리 50/50, 58페이지, 델타 2/58, 네이티브 렌더 히트
  272(264 매핑), 코퍼스 14/14에 문서별 SVG 크기가 v0.8 핀과 동일하고
  글리프 좌표도 일치. wasm 12.29 → **17.54 MB (+43%)**.
  ⚠ 측정 규약: 이 머신은 같은 빌드 편차가 ±30%라 단발 비교는 무의미하다.
  브라우저 A/B는 pkg 2벌을 보관해 **한 세션 내 교대로 여러 라운드**를
  돌리고 **페어 승패**로 판정할 것. 네이티브도 벤치 실행 파일을 빌드별로
  보관해 교대 실행한다. `RDOC_BENCH_PARAS`로 문서 크기를 바꿔 기울기를 본다.
  경위: v0.9.0(S55)·v0.10.1(S56)·v0.11.1(S57)·S63 재스파이크(S58) 보류
  기록과 S59/S60 이행 기록은 docs/ko/worklog/ 참조.
- 업스트림에 변화가 있으면(답변, 수정) 포크 리베이스와 rev 갱신을 검토하고
  worklog에 기록한다. 업스트림 게시(이슈·PR·코멘트)는 사용자 확인 후 한다.

## 알려진 한계 (백로그 후보)

- 역매핑은 F-X037 소스 맵 기반. 6개 스토리 전부 텍스트 편집, Enter/병합은
  본문·표 셀·머리글·꼬리글·각주에서 동작 (미주와 경계 프로젝션 문단은
  거부). 각주 추가/삭제는 Ctrl+Alt+F/D. 미주 조작·셀 간 선택 편집은
  미지원.
- 구조 편집 성능은 S61에서 세 갈래로 잡았다: 노트 캐시 게이트 문단 단위화
  (각주 3.4× → 1.4×), identity 메모이즈(타이핑 15 → 12 ms), provenance에서의
  재시작 허용(Enter/병합 ~3배). 남은 제약은 **꼬리 페이지 재사용**이다 —
  `WordSourcePath`가 본문 인덱스 기반이라 블록 수가 바뀌면 편집 지점 뒤
  페이지를 재사용할 수 없다. 안정 id를 쓰면 풀리지만 업스트림 설계 영역.
- 프리에딧 밑줄은 오버레이 전용 (문서 서식 아님 — 의도된 설계).
- `malgun.ttf`는 MS 라이선스라 저장소에 포함 금지. 재현 시 로컬 복사 또는
  자유 라이선스 한국어 폰트 사용.

## 커밋 규칙

- 단계 단위로 커밋, 메시지는 영어, 본문에 검증 결과 요약.
- 생성물(target/, out/, web/pkg/, 폰트)은 커밋하지 않는다 (.gitignore).

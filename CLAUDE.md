# rdoc 프로젝트 진행 규칙

경량 Rust/wasm DOCX 뷰어·에디터. rhwp의 방법론(AI 페어 프로그래밍 + 검증
우선 + 투명한 기록)을 따른다.

## 단계적 진행 (핵심 규칙)

1. **단계 시작 전**: 이번 단계의 목표·범위·검증 기준을 짧게 제시한다.
2. **구현**: 범위를 벗어나는 확장은 하지 않는다. 발견한 문제는 기록하고
   범위에 넣을지 사용자에게 묻는다.
3. **검증**: 주장하지 말고 실측한다 — 네이티브는 실행 출력, 브라우저는
   헤드리스 스크린샷/타이밍. 실패·한계도 그대로 기록한다.
4. **기록**: `docs/worklog/YYYY-MM-DD.md`에 무엇을 했고 어떻게 검증했는지
   증거(수치, 스크린샷 경로, 커밋)와 함께 남긴다. 중요한 설계 선택은
   `docs/decisions.md`에 추가한다.
5. **확인 게이트**: 단계가 끝나면 결과를 보고하고 **사용자 확인을 받은 뒤**
   다음 단계로 넘어간다. 확인 없이 다음 단계를 시작하지 않는다.

## 빌드·검증 명령

```bash
# 워크스페이스 루트에서 실행. 구조: crates/rdoc-core (코어) + web/ (앱)
# 네이티브 (시스템 폰트): out/에 SVG + 참조 PNG + hits.json
cargo run --release -p rdoc-core --bin poc

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

- 기반: 업스트림 v0.8.0 (F-X032 layout API, F-X037 provenance, F-X038 캐시).
- 의존: 포크 `emptinessform/rdocx` 브랜치 `svg-poc-0.8` (rev 고정,
  Cargo.toml; 로컬 클론 D:\sb\SBDoc\rdocx-fork). v0.8.0 위 리뷰 경계별
  분리 커밋: S2 편집 헬퍼, 번들 폴백 진입점, Arc 타입 브레이크(F-X039
  후보), 재시작 페이지네이션+표/HF 캐시(F-X040 후보), 폴백 엔진
  유지+핸드오프, F-X038 튜닝, 미주 타입 필드 승격·노트/표/이미지 편집
  API, dense-form 레이아웃 수정(중첩 표·vMerge·exact 행·표 스타일
  캐스케이드·셀 앵커), caller 폰트 family 별칭(#44/PR #45로 업스트림
  제출), 리스트/링크/셀 병합/그리드 게터/본문 항목 이동(move_content)/
  이미지 리사이즈(resize_inline_image) 등 에디터 지원 API. SBOdf도
  같은 브랜치에 커밋한다(탭 스톱 등).
  구 브랜치 `svg-poc`(pre-0.8.0)와 `perf-caches`는 참고용 유산.
- 업스트림 상태 (2026-09-06): **v0.12.0 태그**(`19adaacf`, 2026-09-03,
  S64). #65/#66/#67 **모두 종결**. #67은 **F-X075**가 고쳤다 — S58이 짚은
  `Engine::layout_transaction`의 `had_split_paragraph` 거부 분기를 제거하고,
  안전성은 `Pager::finish_page_before`의 완전 블록 경계 체크포인트로 좁혔다.
  업스트림 main은 이미 S68(`c8908d07`)까지 갔으나 스파이크는 태그본만 봤다.
  **S59 결과: 성능 회귀는 대부분 해소, 그러나 이행은 아직 보류(5회째) —
  기능 결손 1건과 새 회귀 2건 때문.**
  **좋아진 것**: 네이티브 타이핑 700문단 min ms 31/34/33/27 → **12/14/14/17**
  (4/4 승, ~2.4배). 브라우저에서 S57·S58의 타이핑 1.24× 회귀 해소(캐럿
  30페이지 1.04×, 1페이지 1.3~1.6× 개선), S58의 **병합 1.53×·undo 1.39×·
  로드 1.54× 회귀 모두 동률로 소멸**. 콜드 레이아웃 3/3 승.
  **포크가 처음으로 줄었다**: 50 → **36커밋**. 업스트림이 F-X039 Arc 타입
  브레이크 2건, F-X040 재시작/표·HF 캐시, 번들 폴백 진입점, caller 폰트
  별칭(우리 #44/PR #45), 표 스타일 tblPr, **dense-form 표 레이아웃 전체**
  (중첩 표·vMerge·exact 행·셀 앵커·테두리 양보·behindDoc), 문단 캐시
  프리필터·캡(50 MB), `add_run_inheriting_mark`를 흡수했다.
  **남은 기능 결손 (이행 전제 조건)**: v0.12.0은 문단 base direction이
  `Auto`가 아니거나 런에 CJK 표의문자(**한자 포함**)·가나·태국어·데바나가리·
  히브리/아랍이 있으면 `PositionedElement::MultilingualText`
  (`MultilingualGlyphRun`)를 내보낸다. **한글은 트리거가 아니다.** rdoc의
  SVG 렌더러·히트 매핑은 `GlyphRun`만 알아서 코퍼스 14개 중 **7개가 백지**
  (LibreOffice가 방향 속성을 붙이므로 CJK 없는 문서도 해당). 렌더+히트
  지원 필요(100~200줄 추정). 같은 계열로 v0.12.0은 모든 요소를
  `PositionedElement::MarkedContent`로 감싸는데, 이건 S59에서 rdoc의 순회
  3곳(`emit_elements`/`collect_hits`/`hash_elements`)을 내려가게 고쳐 해결.
  **남은 회귀 (업스트림 판단 영역)**: 구조 편집이 v0.8보다 느리다 —
  브라우저 **Enter 2.32× (5/5)**, 네이티브 Enter 1.25×·병합 1.35× (4/4),
  **각주 삽입/삭제 4× (4/4)**. 소스 노드 테이블이 바뀌면 재시작 레코드를
  다시 발행해야 하고 `restart_body_identity`가 블록마다 XML을 직렬화하는
  비용으로 보이나 계측으로 확정하지 않았다.
  기능 등가: 브라우저 배터리 50/50, 58페이지, 델타 2/58, 네이티브 PoC 히트
  272(264 매핑). wasm 12.29 → **17.53 MB (+43%)**.
  포크 `svg-poc-0.12`(6d71cb3d), rdoc `s59-v0120-spike`.
  ⚠ 측정 규약: 이 머신은 같은 빌드 편차가 ±30%라 단발 비교는 무의미하다.
  브라우저 A/B는 pkg 2벌을 보관해 **한 세션 내 교대로 여러 라운드**를
  돌리고 **페어 승패**로 판정할 것. 네이티브도 벤치 실행 파일을 빌드별로
  보관해 교대 실행한다.
  경위: v0.9.0(S55)·v0.10.1(S56)·v0.11.1(S57)·S63 재스파이크(S58) 보류
  기록은 docs/worklog/ 참조.
- 업스트림에 변화가 있으면(답변, 수정) 포크 리베이스와 rev 갱신을 검토하고
  worklog에 기록한다. 업스트림 게시(이슈·PR·코멘트)는 사용자 확인 후 한다.

## 알려진 한계 (백로그 후보)

- 역매핑은 F-X037 소스 맵 기반. 6개 스토리 전부 텍스트 편집, Enter/병합은
  본문·표 셀·머리글·꼬리글·각주에서 동작 (미주와 경계 프로젝션 문단은
  거부). 각주 추가/삭제는 Ctrl+Alt+F/D. 미주 조작·셀 간 선택 편집은
  미지원.
- 문단 삽입/삭제(Enter/병합)는 소스 노드 테이블이 바뀌어 페이지네이션
  캐시 전체 폴백 (타이핑은 증분).
- 프리에딧 밑줄은 오버레이 전용 (문서 서식 아님 — 의도된 설계).
- `malgun.ttf`는 MS 라이선스라 저장소에 포함 금지. 재현 시 로컬 복사 또는
  자유 라이선스 한국어 폰트 사용.

## 커밋 규칙

- 단계 단위로 커밋, 메시지는 영어, 본문에 검증 결과 요약.
- 생성물(target/, out/, web/pkg/, 폰트)은 커밋하지 않는다 (.gitignore).

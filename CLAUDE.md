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
- 업스트림 상태 (2026-08-26): **v0.10.1 출시** (v0.10.0은 부분 배포로
  중단, v0.10.1이 완전판). #44/#45는 F-X051(0b1861a), #46은
  F-X052(0015159)로 처리 — 셋 다 종결, CHANGELOG Fixed에 링크·크레딧.
  MarkedContent 마이그레이션 노트도 반영(v0.9.0 호환성 절 소급 정정 +
  hld 문서). **S56 재스파이크 결과 이행 재보류**: 기능 완전 등가
  (배터리 50/50, 코퍼스 14/14, 히트 272, 57페이지 동일)이고 포크는
  폰트 별칭 3커밋을 더 폐기할 수 있으나, 타이핑 1.46×·undo 2.15× 회귀.
  원인은 v0.10.1 `rdocx-layout/src/engine.rs:1236`의 재시작 페이지네이션
  **문서 전역 적격 게이트**. bench2 단일 변수 분리로 확정된 것은
  **각주 절벽**: 각주가 없으면 v0.10.1이 0.8보다 2× 빠른데(3~5 vs
  8~14 ms), 각주 **1개**만 넣으면 19/14/16 ms로 4× 느려진다(0.8은
  6/8/10 ms로 무반응) — `input.footnotes.is_none()`과 대응. 머리글/꼬리글도
  약한 동형 효과. **`lines.len() <= 2`는 원인이 아님**(런타임 오버라이드로
  2/4/64 스윕 — 구분 불가, 가설 철회). 4줄 문단의 1.3×는 미해결. 포크 `svg-poc-0.10`, rdoc `s56-v0101-spike`,
  적응 패치 docs/upstream/2026-08-26-rdoc-v0101-adaptation.diff로 보존.
  → 게이트 데이터를 새 이슈로 보고할지는 사용자 확인 대기.
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

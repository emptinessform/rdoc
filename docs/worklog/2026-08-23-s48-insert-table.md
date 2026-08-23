# 2026-08-23 — S48: 표 삽입 (사용자 피드백 4-1)

## 목표·범위

캐럿 위치에 새 표 삽입 — 삽입 메뉴 "표…" → 인라인 바(행×열 입력).
d&d 열 폭 조절은 S49.

## 한 일

- **포크 무수정** — `Document::insert_table(index, rows, cols)`(균등
  dxa 폭, 셀마다 빈 문단)가 업스트림에 이미 있었음. wasm
  `insert_table_after(path, rows, cols)`: 캐럿의 본문 최상위 문단
  **바로 뒤**에 삽입 + 단선 회색 테두리(무테두리 표는 화면에서
  보이지 않아 기본 부여), 1 undo, 크기 가드(1~50×1~20).
- UI: 표바(#tablebar — 행/열 number 입력, 기본 3×3), 삽입 메뉴 "표…",
  삽입 후 캐럿은 첫 셀로. `__t.insertTable`.

## 검증 (실측)

- 신규 tblinsert-test 9단정: 2×3 삽입 → 첫/끝 셀 존재·초과 열 없음·
  뒤 문단 경로 시프트·캐럿 첫 셀, 셀 타이핑, 저장 왕복, 기존 구조
  연산(열 추가)이 새 표에 동작.
- 전체 배터리 **45/45 그린**, 네이티브 lib 9/9.

## 사고·교훈 (개발 루프 인프라 2건)

- 재빌드한 wasm의 새 API가 "not a function" — 데몬 렌더러의 **메모리
  캐시**가 헤더와 무관하게 구 모듈을 서빙(transferSize 0으로 진단).
  http.server의 휴리스틱 캐시 문제도 겸사 발견.
- 조치: ① `web/serve.py`(no-cache 헤더 dev 서버)로 교체, ②
  **wasm/pkg 재빌드 후 `browse restart` 필수** 규칙을 tests README
  최상단에 명기.

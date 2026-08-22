# 2026-08-22 — S10-1: 셀 간·문단 간 선택 편집

## 목표·범위

같은 문단 안으로 제한돼 있던 선택 삭제/치환(문단 간은 본문 최상위만)을
두 모양으로 확장한다: ① 같은 컨테이너의 형제 문단들(본문 연속 구간, 한
셀 안, 머리글/꼬리글, 각주, 미주) — Word식 병합 삭제, ② 컨테이너를 넘는
흩어진 선택(셀 → 옆 셀) — 문단별 텍스트만 제거(구조 유지, Word 근사).
포크 변경 없음(승격/병합 API 재사용).

## 구현 (rdoc만)

- lib.rs: `sibling_locus`(경로 → 컨테이너 열쇠+형제 인덱스), `at_sibling`,
  `merge_at`(전 스토리 병합 디스패처), `delete_range_across`(머리 꼬리
  자르기 → 중간 비우기 → 꼬리 머리 자르기 → 반복 병합; 중간에 표 등
  비문단이 끼면 실패).
- wasm.rs: `delete_selection`/`replace_selection`의 문단 간 분기를
  컨테이너 일반화(`sibling_ends` 정규화 포함)로 교체 — 본문 전용이던
  기존 paragraphs()-순서 경로 대체. 흩어진 선택용
  `delete_ranges(json)`/`replace_ranges(json, text)` 신설(문단별
  `{path,start,end}` 배열, 1 히스토리 엔트리, 치환 텍스트는 첫 구간
  시작에 삽입).
- index.html: `selRange()`가 `{kind: same|siblings|scatter}` 판별.
  siblings = 마지막 숫자 세그먼트만 다른 경로. scatter는 히트 목록을
  걸으며 선택이 덮은 d/ 문단별 [min,max) 구간으로 분해(노트 마커 등
  d/ 외 경로는 방어적으로 제외). `toggleFmt` 가드를 `kind !== "same"`으로
  수정(scatter에서 undefined 인자로 진행하던 구멍).
- **mutate 원자성 수정 (잠복 버그)**: 연산 실패 시 체크포인트를 pop만
  하고 문서를 복원하지 않아, 다단계 연산이 중간에 실패하면 부분 변경이
  남았다. 실패 시 체크포인트 바이트로 문서를 복원(`replace_doc` — 폴백
  엔진 이월 유지)하도록 수정. 조합(IME) 중 연산은 단일 단계라 해당 없음.

## 검증 (실측)

- cellsel-test.js 그린:
  - 셀 안 형제: "Text"를 Enter로 "Te|xt" 분할 후 경계 걸친 "e\nx" 선택
    삭제 → "Tt" 한 문단, undo 2회 완전 복원.
  - 셀 간 scatter: "T[ext … Gl]yphRun" 선택 삭제 → "T"/"yphRun", 셀
    구조 유지, **undo 1회**에 두 셀 동시 복원.
  - 셀 간 타이핑 치환: "X" → 첫 셀 "TX"(캐럿 off 2)/"yphRun", undo 1회.
- 본문 형제 프로브: d/4→d/5 걸친 선택 삭제 → 병합 "이 리고 이 문장에는
  미주가…", undo 복원.
- 표 가로지르기 거부 프로브: d/9→d/11(사이에 표) 삭제 시도 →
  **첫 실행에서 부분 변경 발견**(d/9가 "L"로 잘린 채 거부) → mutate
  복원 수정 후 재실행: 문서 완전 불변 확인.
- 회귀 11종 그린: cellsel / shift / ux3 / ime / en / split / note /
  noteops / enops / roundtrip / empty.

## 알려진 근사·한계

- 선택 범위 안의 각주/미주 참조 마커는 살아남는다 (참조 런은 텍스트가
  없어 trim에 안 걸림; Word는 노트째 삭제). 백로그.
- 본문 선택이 표를 가로지르면 거부 (Word는 표째 삭제). 백로그.
- scatter 치환의 삽입 위치는 첫 구간 시작 (Word와 동일).

## 배운 것

- "실패 시 무변경"은 단일 단계 연산에서는 공짜지만 다단계 연산에서는
  트랜잭션 복원을 명시적으로 구현해야 한다. 이번에 새 기능이 아니라
  기존 mutate의 잠복 결함이 드러난 것 (knowledge §11).

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

---

# S10-2: UX 소품 3종 (트리플클릭·드래그 자동 스크롤·↑/↓ 스토리 유지)

## 목표·범위

S8 백로그의 마지막 UX 소품. 전부 index.html JS만.

## 구현

- **트리플클릭 문단 선택**: mousedown `e.detail >= 3`에서 해당 문단
  [0, len) 선택. dblclick의 오프셋→히트참조 변환을 `refForOffset`/
  `selectParaOffsets`로 추출해 공유. `mouse.tripled` 플래그로 mouseup의
  캐럿 배치를 건너뜀.
- **드래그 중 자동 스크롤**: mousemove가 포인터 정지 시 더 안 오는 문제
  → rAF 루프(`dragAutoScroll`)가 마지막 포인터 위치를 기억해 뷰포트
  가장자리 28px 안이면 계속 스크롤하며 선택을 재확장(`extendDragTo`,
  `elementFromPoint`로 페이지 재결정). mouseup에서 루프 취소.
- **↑/↓ 스토리 유지**: `lineTarget`이 "가장 가까운 줄"을 잡을 때 캐럿과
  같은 스토리 접두사(d/·h/·f/·fn/·en/)의 히트만 고려. 종전에는 본문
  마지막 줄에서 ↓가 각주 블록·다음 페이지 머리글로 새고, 미주에서 ↑가
  전 페이지 꼬리글로 넘어갔음.

## 검증 (실측)

- ux4-test.js 그린: 트리플클릭 = 한글 문단 83자 전체 선택(캐럿 해제),
  본문 마지막 줄 ↓ = 제자리(아래에 d/ 줄 없음 — 각주로 새지 않음),
  미주에서 ↑ = en/ 유지, 드래그 하단 가장자리 고정 600ms에 scrollY
  756→1080 + 선택 성장.
- 회귀 그린: ux2 / ux3 / shift / cellsel / ime.

---

# S10-3: 선택 안 노트 마커 삭제 (Word 동작)

## 목표·범위

선택 삭제/치환이 각주·미주 **참조 마커**를 덮으면 노트째 삭제한다
(Word 동작). S10-1의 알려진 근사 해소.

## 구현 (포크 a9f10ee + rdoc)

- 포크: `Paragraph::note_refs() -> Vec<(is_footnote, id, char_pos)>` —
  참조 런 앞의 텍스트 문자 수로 위치 열거 (런 단위 근사).
- lib.rs: `covered_note_refs(doc, at, after, before)`(배타 경계, 본문
  스토리만), `remove_notes`. `delete_range_across`가 머리(pos>oa)/중간
  (전부)/꼬리(pos<ob) 참조를 수집·중복 제거 후 **텍스트 삭제 전에** 노트
  제거 (참조 런은 텍스트가 없어 문자 오프셋 불변 — 순서 무관).
- wasm: 같은 문단 delete/replace_selection, scatter delete/replace_ranges
  모두 동일 수집(strict 내부: start < pos < end) 후 노트 제거.
- 경계 규칙: 오프셋 공간에서 마커는 폭 0이라 "선택 시작/끝과 정확히 같은
  위치"는 마커가 선택 안인지 밖인지 구별 불가 → 보수적으로 배타(마커
  유지). 문단 꼬리를 지나 다음 문단으로 이어지는 선택(across 머리)은
  문단 끝 마커 포함.

## 검증 (실측)

- 네이티브 단위 테스트 `deletion_range_covering_note_ref_removes_note`:
  내부 커버 감지/경계 배타, across 삭제로 각주+미주 동시 소거, 왕복.
- notesel-test.js 그린: d/4[2..]→d/5[..3] 선택 삭제 = 병합 텍스트 정확,
  **각주(마커가 범위 안) 소거 + 미주(마커가 범위 밖) 생존**, undo 1회
  복원. 문단 중간 마커를 덮어 타이핑 = 텍스트 치환 + 노트 소거, undo
  복원. 첫 실행 실패는 테스트 좌표 산술(한글 히트가 음절 세그먼트로
  분할)이었고 기능은 정상 — 오프셋 커버 세그먼트 기반 xAt로 수정.
- 회귀 그린: cellsel / en / noteops / enops / shift / ime / roundtrip.
- 포크 rev a9f10ee 고정, 네이티브 릴리스 빌드 확인.

---

# S10-4: 표를 가로지르는 본문 선택 — 표째 삭제 (Word 동작)

## 목표·범위

선택 편집의 마지막 백로그. 본문 최상위 선택이 표를 사이에 두면 종전엔
원자적 거부 → Word처럼 표(및 중간 문단)를 통째 삭제하고 양끝을 병합.

## 구현 (포크 7c114e8 + rdoc)

- 포크: `Document::note_refs_in_content(body_index)` — 문단 또는
  표(중첩 포함) 안의 모든 노트 참조 열거. 삭제될 표 안에서 참조된
  노트도 같이 지우기 위함.
- lib.rs `delete_range_across`: 양끝이 본문 최상위(children.len()==1)면
  별도 경로 — 노트 수집(머리 pos>oa / 중간 콘텐츠 전체 / 꼬리 pos<ob)
  → 노트 제거 → 머리·꼬리 트림 → 중간 콘텐츠를 `remove_content`로
  통째 제거(문단·표 동일) → 병합. 본문 최상위의 형제 인덱스가 곧 body
  content 인덱스라 표가 끼어도 산술이 그대로 성립.
- JS 변경 없음 (siblings 분기가 이미 d/N↔d/M을 이 경로로 보냄).

## 검증 (실측)

- 네이티브 단위 테스트 `body_selection_spanning_a_table_deletes_it`:
  문단/표(셀에 각주 참조)/문단 → across 삭제 = 표 제거·양끝 병합·표 안
  참조 각주 소거·왕복.
- 브라우저 프로브: d/9[1..]→d/11[..2] (사이에 데모 표) 삭제 = 병합
  "Lend of PoC page —" 정확, d/10·셀 경로 소멸, undo 1회에 표·셀 텍스트
  포함 전체 복원.
- 회귀 그린: cellsel / notesel / shift / ime / roundtrip / split.
- 포크 rev 7c114e8 고정, 네이티브 릴리스 빌드 확인.

이로써 선택 편집 백로그 소진 — 같은 문단 / 형제 문단(전 스토리) /
셀 간 scatter / 표 포함 본문, 노트 마커 삭제까지 Word 의미론 정합.

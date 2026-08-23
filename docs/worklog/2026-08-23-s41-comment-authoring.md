# 2026-08-23 — S41: 주석 작성/삭제/해결 (M2)

## 목표·범위

S37 주석 표시의 완결 — 선택 범위에 주석 추가(주석바), 캐럿 위치
주석 삭제·해결 전환. 답글(reply_to)은 후속.

## 한 일

- **포크 무수정** — add_comment(RunRange)/remove_comment/
  resolve_comment/reply_to 전부 업스트림에 있었음.
- rdoc lib `run_range_at`: 문자 오프셋 [start,end)를 경계 분할 후
  업스트림 RunRange가 원하는 런 삽입 인덱스 쌍으로 변환.
- wasm 3종(각 1 undo): `add_comment(path,start,end,author,text)` —
  본문 최상위 문단 전용(업스트림 앵커 제약), `remove_comment(id)`,
  `resolve_comment(id,resolved)`.
- UI: 주석바(#commentbar — find/link 바 패턴), 삽입 메뉴 3항목
  (주석…/주석 삭제/주석 해결 전환 — 삭제·해결은 캐럿 위치의 스팬
  id로), 추가 후 주석 표시 자동 켬. `commentIdAtCaret`는 표시 토글과
  무관하게 동작(메뉴 액션용).

## 검증 (실측)

- comment-test 확장 +7단정: "world"(13..18) 선택→추가→목록 2개·스팬
  정확, **저장 왕복이 작성 주석 보존**, 해결 전환 resolved=true,
  삭제 후 목록 1개·스팬 소멸, undo 복원.
- 전체 배터리 **42/42 그린**, 네이티브 lib 9/9.

## 한계·후속

- 문단 간(cross-paragraph) 주석 범위, 표 안 앵커, 답글/저자 설정 UI
  후속. 저자는 "rdoc" 고정.

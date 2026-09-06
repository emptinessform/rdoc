# 2026-08-23 — S30: 툴바 상태 표시 (M1)

## 목표·범위

캐럿/선택 위치의 서식이 툴바에 실시간 반영 — B/I/U 눌림, 글꼴·크기
필드 값. 두 단계(S14, S29)에서 미뤄 온 항목.

## 한 일

- wasm `caret_format(path, off)` (읽기 전용): 캐럿 왼쪽 문자를 덮는
  런(Word 규칙, offset 0은 첫 런)의 서식 스냅샷
  `{bold, italic, underline, size, family, color}` — b/i/u는 토글이
  쓰는 effective 판정(is_bold 등), 나머지는 직접 속성.
- lib `caret_format_in/_at`: 6개 스토리 공용 (with_paragraph_at 관문).
- UI `updateToolbarState()` (format.ts): 캐럿이면 caret_format,
  선택이면 B/I/U는 기존 `ranges_format_on`(all-on 규칙) + 글꼴/크기는
  선택 시작 문자 기준. `report()`에서 호출 — 모든 캐럿/선택/편집
  경로가 이미 지나는 지점이라 배선 1곳. 입력 중인 필드는 덮어쓰지
  않음(activeElement 검사). `.on` 스타일(파란 눌림).
- 글꼴 드롭다운은 이제 현재 값을 표시 (적용 후 플레이스홀더 복귀
  로직 제거 — 상태 표시가 값을 소유).
- 신규 스위트 toolbar-test: bold 단어에서 B on/I off, italic 단어에서
  반전, 16pt 런에서 크기 "16", 평문에서 전부 off, bold 내부 선택은
  B on / bold+평문 혼합 선택은 all-on 규칙으로 B off — 6단정.

## 검증 (실측)

- toolbar-test PASS, 전체 배터리 **34/34 그린** (플레이크 0).
- 증거: docs/evidence/s30-toolbar-state.png — 16pt 런 클릭 시 크기
  필드 "16".

## 한계·후속

- 직접 속성 기반이라 스타일 상속 서식(예: 제목 스타일의 크기)은
  필드에 비어 보임 — effective 캐스케이드 읽기는 업스트림 resolve
  API 필요, 후속.
- 색 스와치는 미반영 (input[type=color] 값 갱신은 사소하나 후속).

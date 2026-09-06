# 2026-08-23 — S53: 표 테두리 + 셀 배경색

## 목표·범위

표 전체 테두리(스타일 8종·두께·색)와 셀 배경색 설정. 포크 커밋 없음
(Table::set_borders / Cell::set_shading 기존 API 사용).

## 한 일

- wasm: `set_table_borders(path, style, width_pt, color)` — 바깥
  4변+내부 격자 일괄(none/single/thick/double/dotted/dashed/dotdash/
  wave, 0.25~6pt, 6-hex 가드, 1 undo); `set_cell_shading(paths, color)`
  — 셀 문단 경로들의 셀에 배경 채움(1 undo).
- UI: 툴바 표 그룹에 **셀 배경색 picker**(#cellshade) — S50 셀 블록
  선택 소비(블록이 없으면 캐럿 셀); 서식 메뉴 "표 테두리…" →
  인라인 바(#borderbar: 스타일/두께/색/적용) — 캐럿·블록의 표에 적용.

## 검증 (실측)

- 신규 tblstyle-test 10단정: **실제 UI 경로**(selectCells + color
  picker change)로 2셀 셰이딩 → SVG fill rgb 매칭 rect ≥2·블록
  소비·undo 제거; 캐럿 셀 단독 셰이딩; dashed 빨강 1.5pt →
  stroke 매칭 라인 다수·undo 복원; none 스타일 → 테두리 라인 0
  (single 대조군과 교차 확인); 저장 왕복에 셰이딩+double 파랑
  테두리 보존.
- 함정 1건: 렌더러는 색을 `rgb(r,g,b)`로 방출 (hex 아님) — 단정
  헬퍼를 rgb 비교로 수정.

## 한계·후속

- 셀 단위 개별 변(위/아래/좌/우만) 테두리는 포크 쓰기 API가 없어
  범위 밖. 배경 "지우기"(shading 제거)도 API 부재 — 흰색 지정으로
  대체 가능.

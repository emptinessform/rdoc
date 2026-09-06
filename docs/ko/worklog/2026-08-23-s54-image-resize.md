# 2026-08-23 — S54: 이미지 크기 조절

## 목표·범위

선택된 인라인 이미지의 우하단 모서리 핸들 드래그로 비율 유지 크기
조절 (1 undo). 저장 왕복 보존.

## 한 일

- **포크 (29a4a5c)**: `Document::resize_inline_image(index, width_emu)`
  — remove_inline_image와 같은 문서 순서 카운팅으로 인라인 Drawing의
  extent를 비율 유지 스케일. **함정: CT_Inline.raw_xml**(라운드트립
  보존용 원본 바이트)이 있으면 extent 변경이 저장에 안 실림 →
  리사이즈 시 raw_xml을 비워 구조 직렬화로 재구성(임베드/크기에서
  pic 재생성; 비모델 속성은 잃을 수 있음 — 주석 명기). 앵커 이미지는
  거부. rev 핀 f8659c8 → 29a4a5c.
- wasm: `resize_image(index, width_pt)` (10~1000pt 가드, 1 undo).
- UI imgresize.ts: 이미지 클릭 선택 시 우하단 핸들(.imghandle) 표시,
  드래그 중 점선 고스트가 비율 유지로 따라옴, 릴리스에서 커밋.
  clipboard.ts의 선택/해제와 연동.

## 검증 (실측)

- 신규 imgresize-test 10단정: API 150pt — 폭 ±1pt·비율 보존(±0.01)·
  undo 복원; 클릭 선택 → 핸들 표시; **실드래그 +40pt** — 고스트
  표시/제거·커밋 ±3pt·undo; 120pt 후 저장 왕복 폭 ±1pt 유지
  (raw_xml 드롭 검증이 여기서 실효).
- 전체 배터리 **50/50 그린**(pdf/tblstyle/imgresize 포함), 네이티브
  9/9.

## 한계·후속

- 앵커(배치형) 이미지 크기 조절 미지원(인라인만). 좌상단 핸들 등
  4방향 핸들 없음(우하단 1개 — 인라인이라 좌상단 고정이 자연스러움).

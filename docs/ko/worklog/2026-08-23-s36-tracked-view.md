# 2026-08-23 — S36: 변경 추적 보기 (M2)

## 목표·범위

변경 추적 문서의 **최종(Accepted) ↔ 변경 내용 표시(Tracked)** 보기
토글. Tracked는 읽기 전용 (편집 경로는 최종 투영의 소스맵과 결합).

## 한 일

- **포크 (핀 235d56f)**: bundled-fallback 레이아웃에 RenderOptions
  변형 추가 (`layout_with_fonts_aliases_options_and_bundled_fallback`)
  — Tracked 투영을 영속 엔진 경로로. RevisionView(Accepted/Tracked)와
  Tracked 데코레이션 렌더는 업스트림에 이미 있었음.
- wasm: `set_revision_view(tracked)` — **편집이 아닌 보기 전환**
  (히스토리 무기록, 렌더 캐시 클리어 후 전체 델타 반환),
  `has_revisions()` 읽기. 두 레이아웃 호출부에 options 배선.
- UI: 보기 메뉴 "변경 내용 표시 (읽기 전용)" 토글. **읽기 전용
  강제는 edit() 단일 차단점** — 툴바/메뉴/키보드/테스트 훅의 모든
  변이가 edit()를 지나므로 한 곳의 가드로 전체가 막힘.
- 픽스처 web/trackview-test.docx (ins "NEW " + del "OLD ").

## 검증 (실측)

- 신규 trackview-test 8단정: 최종 보기 = NEW 표시·OLD 숨김,
  Tracked = 둘 다 렌더, Tracked 중 타이핑 무변화(차단), 토글 복귀 후
  OLD 숨김 + 편집 재개, 데모는 has_revisions false.
- 전체 배터리 **40/40 그린**, 네이티브 lib 9/9 + corpus 14/14.

## 사고·확인 요청

- 포크 커밋(38f2aa8)에 `git add -A`가 **작업 트리에 있던 미커밋
  synthetic-italic WIP 5파일**(oxml-layout font/lib/output +
  oxml-pdf raster/writer — FontData.synthetic_italic 배관)을 쓸어담는
  사고. 즉시 **235d56f로 되돌리는 커밋**을 쌓고(강제 푸시 없이 정직한
  히스토리), WIP는 로컬 작업 트리에 미커밋 상태로 보존.
  **출처 확인됨(사용자)**: D:\sb\SBOdf 프로젝트에서 진행 중이던
  작업 — 같은 포크 클론을 두 프로젝트가 공유. WIP는 작업 트리에
  미커밋 보존, SBOdf 쪽에서 계속.
- 교훈: 포크 클론은 다른 프로젝트와 공유됨 — **포크 커밋 시
  `git add -A` 금지, 대상 파일 명시** + 커밋 전 `git status` 확인.

## 한계·후속

- Tracked 보기에서 삽입/삭제의 저자·시각 표시(말풍선/색 구분)는
  업스트림 데코레이션 수준을 따름 (우리 쪽 추가 표시 없음).
- 변경 수락/거부 편집은 미지원 (M2 후속 후보).

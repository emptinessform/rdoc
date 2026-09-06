# 2026-08-23 — S32: 하이퍼링크 (M1)

## 목표·범위

선택 텍스트 링크 삽입/제거, 링크 시각 표시(파랑+밑줄), Ctrl+클릭
열기, Ctrl+K 링크바.

## 한 일

- **포크 (핀 7575436)**: `Paragraph::wrap_hyperlink(run_start,
  run_end, rel)` — 기존 런 감싸기(빈/범위 밖/기존 스팬과 겹침 거부;
  스팬 리스트 끝에 push라 리비전 슬롯 안정),
  `unwrap_hyperlink(index)` → `CT_P::remove_hyperlink_span` (보수적:
  미모델 raw XML 보유 스팬, 이 스팬 이후 인덱스에 묶인 추적 리비전
  있으면 거부), 빌더 쪽 `hyperlink_spans_value` 게터. 스팬은 런
  인덱스 기반이고 insert_unwrapped_run이 분할 시 자동 조정해 기존
  split_run 골격과 그대로 합치됨. add_hyperlink(append 전용)·
  hyperlink_url은 업스트림에 이미 있었음.
- **rdoc lib**: hyperlink_extents(런 경계→문자 오프셋 변환),
  `set_hyperlink_at`(경계 split 후 커버 런 wrap + Word 기본 링크 룩
  #0563C1+밑줄 직접 서식), `remove_hyperlink_at`(unwrap + 룩 정리),
  `hyperlink_rel_at`.
- **wasm 3종**: `set_hyperlink(path, start, end, url)` — **본문 전용**
  (관계가 document part rels에 저장되므로; 머리글/노트 스토리는
  해당 파트 rels가 필요해 후속), `hyperlink_at`, `remove_hyperlink`.
  각 1 undo.
- **UI**: 링크바(#linkbar — findbar 패턴; **네이티브 prompt는 헤드리스
  차단 이슈로 배제**), Ctrl+K, 삽입 메뉴 항목(하이퍼링크…/링크 제거),
  **Ctrl+클릭 = 캐럿 이동 없이 새 탭 열기**(window.open noopener).
  링크바를 열면 캐럿 위치의 기존 URL을 보여줌. 붙여넣기 가드에
  linkq 추가.

## 검증 (실측)

- 신규 link-test 8단정: 선택 링크 적용 → URL 읽기/경계 밖 null →
  링크 룩(#0563C1) 렌더 → **Ctrl+클릭이 stub window.open에 URL 전달**
  → 저장 왕복 보존 → 해제(URL·룩 제거) → undo 복원.
- 전체 배터리 **36/36 그린** (플레이크 0), 네이티브 lib 9/9 +
  corpus 14/14.

## 한계·후속

- 본문 스토리 전용 (머리글/꼬리글/노트는 파트별 rels 배선 후속).
- 내부 앵커(북마크) 링크 미지원 — 외부 URL만.
- 링크 룩은 직접 서식 (Word의 Hyperlink 문자 스타일 참조가 아님) —
  해제 시 밑줄/색을 함께 정리하므로 실사용 동등.

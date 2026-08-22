# 2026-08-22 — S6-1: 소스 맵 역매핑 + 표 셀 편집

텍스트 매칭 우회를 **F-X037 공식 소스 맵**으로 교체하고, 이를 기반으로
표 셀 편집을 열었다. 포크 `svg-poc-0.8` 47eb47a (경로 해석 헬퍼 +
provenance 타입 재수출), rdoc 쪽은 lib.rs/wasm.rs/index.html 전면 전환.

## 구현

- **히트 매핑 v2**: `map_hits_to_doc`(그리디 텍스트 매칭) 삭제. 각
  글리프런의 `SourceSpan`을 `WordLayoutResult::source_node`로 해석해
  히트런에 **컴팩트 경로 문자열** 부착 — `"d/12"`(본문), `"d/8.1.0.0"`
  (표 셀: row.cell.content 반복), `"h/rId3/0"`(머리글) 등. `start`는
  `char_start` 그대로 (오프셋 추정 제거). 결과-로컬 SourceNodeId는
  러스트 안에서만 사용 — JS 경계엔 구조 경로만 노출되어 레이아웃 간
  안정적.
- **주소 체계 전환**: 캐럿/선택/모든 wasm 편집 API가 (para,off) →
  (path,off). 포크에 `paragraph_at_path_mut`/`paragraph_text_at_path`
  (중첩 표 임의 깊이). 본문 전용 연산(Enter/병합/문단 간 선택)은
  `path_order`/`order_path` 변환으로 기존 로직 재사용.
- **표 셀 편집**: 삽입/삭제/IME 조합/서식 토글/셀 내 선택 대치 모두
  경로로 동작. 셀 내 Enter/병합은 명시 거부(문서 불변). 셀 간 선택
  편집도 거부.
- 머리글/각주 히트는 경로 표시 + "편집은 후속" 안내 (캐럿 없음).

## 검증

- 코퍼스 매핑률: **표 문서 0 → 전부** (table_libre_office 4/4,
  nested_table 2/2), header_footer 4/4 (h/ 경로), footnotes 본문 2/4
  (마커는 의도적 비귀속). 14파일 렌더 회귀 없음.
- 브라우저 (demo.docx): 셀 히트 139개, `d/8.1.0.0`에서 —
  타이핑/백스페이스/undo/**IME 조합**/선택 대치(+undo)/Enter 거부/본문
  회귀 — 7시나리오 전부 통과. 기존 IME 7시나리오·프리에딧 5조 그린.
  스크린샷: `docs/evidence/s6-cell-edit.png` (셀 안 "편집됨" 타이핑).
- 성능 회귀 없음: 네이티브 31ms (min 28), wasm 타이핑 92~118ms,
  델타 "1/63 pages redrawn" 유지. 테스트 7/7.

## 알려진 한계 (백로그)

- 셀 내 Enter(문단 분할)·셀 간 선택 편집 미지원 (명시 거부).
- 머리글/꼬리글/각주 편집 미지원 — 히트 경로는 이미 있음; 헤더 파트
  재직렬화 경로가 필요.
- 선택 대치(replaceSel)는 삭제+삽입 2개 undo 엔트리 (기존 동작) —
  원자화 후보.
- 증거 스크린샷에서 #23 글리프 중복("ttf-pparser")이 그대로 관찰됨 —
  업스트림 F-X041 대기.

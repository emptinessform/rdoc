# rdoc

**서버 없이 브라우저에서 도는 경량 Rust/wasm DOCX 뷰어·에디터**

**[온라인 데모](https://emptinessform.github.io/rdoc/)** (개발 프리뷰 —
main 푸시마다 자동 배포, 한국어 폰트는 Pretendard)

[rhwp](https://github.com/edwardkim/rhwp)("모두의 한글")가 HWP에서 증명한 것을
DOCX에서 재현하는 프로젝트입니다. 차이점: DOCX는 파서·레이아웃 엔진이
오픈소스 [rdocx](https://github.com/tensorbee/rdocx)로 이미 존재하므로,
이 프로젝트는 **그 위에 브라우저 렌더러와 에디터 계층을 쌓는 것**에 집중합니다.

## 왜

- 기존 브라우저 DOCX 편집기는 서버가 필요하거나(OnlyOffice, Collabora),
  wasm이어도 거대합니다(ZetaOffice ~1GB). 이 프로젝트의 wasm은 현재
  **10.9MB (gzip 5.0MB)** 입니다.
- 결과물 SVG는 글리프가 벡터 패스로 내장된 자기완결 문서 —
  뷰어에 폰트가 없어도 동일하게 렌더링됩니다 (1페이지 gzip ~40KB).
- 한국어 조판(폰트 폴백·셰이핑)을 1급 요구사항으로 다룹니다.

## 현재 상태 (2026-08-22)

브라우저에서 도는 편집기가 상당한 완성도에 도달했습니다:

- **편집**: 6개 스토리 전부(본문·표 셀·머리글·꼬리글·각주·미주) 타이핑,
  한글 IME(조합 = undo 1단위), Enter/병합, 각주·미주 삽입/삭제
- **선택 편집 (Word 의미론)**: 같은 문단 / 여러 문단 / 셀 간 / 표를
  가로지르는 선택의 삭제·치환, 선택에 덮인 노트는 노트째 삭제
- **클립보드**: 복사·잘라내기·붙여넣기(멀티라인 = 문단 분할, undo 1회),
  클립보드 이미지 붙여넣기
- **찾기/바꾸기**: Ctrl+F/H, 전 스토리, 모두 바꾸기 = undo 1회
- **서식**: B/I/U·문단 정렬·글자 크기·문단 스타일 — 임의 선택 모양에서
  각각 undo 1회
- **표 구조**: 행/열 추가·삭제 (서식 상속, tblGrid 동기)
- **이미지**: 캐럿 위치 인라인 삽입 (파일/클립보드)
- **뷰어**: 페이지 썸네일 패널, 지연 페이지 렌더(가시 페이지 우선),
  .docx 저장/열기 왕복

**성능** (63페이지 문서): 키 입력당 네이티브 min 23ms(게이트 <30ms),
브라우저 min ~70ms · 1/63페이지만 재렌더. 구조 연산(Enter 등)은 브라우저
~211ms + 화면 밖 페이지 idle 렌더.

코드는 [`crates/rdoc-core/`](crates/rdoc-core/)와 [`web/`](web/), 브라우저
테스트 스위트 32종은 [`web/tests/`](web/tests/), 상세 기록은
[`docs/worklog/`](docs/worklog/), 과정에서 나온 지식 정리는
[`docs/knowledge.html`](docs/knowledge.html)에 있습니다.

## 실행

```bash
# 구조: crates/rdoc-core (렌더·편집 코어) + web/ (에디터 앱). 루트에서 실행.
# 네이티브 (시스템 폰트 사용): out/에 SVG + 참조 PNG 생성
cargo run --release -p rdoc-core --bin poc

# wasm 에디터
wasm-pack build crates/rdoc-core --release --target web --out-dir ../../web/pkg -- --no-default-features
# 한국어 폰트 준비 (저장소에 포함하지 않음 — 라이선스):
#   Windows: cp /c/Windows/Fonts/malgun.ttf web/
#   또는 Noto Sans KR 등 자유 라이선스 폰트를 web/malgun.ttf로
cd web && python -m http.server 8741   # → http://localhost:8741
```

## 업스트림 관계

제안 다수가 rdocx **v0.8.0**에 수용·크레딧됐고(F-X032 layout API,
F-X037 소스 맵, F-X038 문단 캐시), 현재는 v0.8.0 위에 리뷰 경계별 커밋을
쌓은 [포크 브랜치 svg-poc-0.8](https://github.com/emptinessform/rdocx/tree/svg-poc-0.8)을
rev 고정으로 의존합니다:

- 성능 제안 [#40](https://github.com/tensorbee/rdocx/pull/40)·[#41](https://github.com/tensorbee/rdocx/pull/41)
  — 업스트림이 F-X039/40/43~47 강화판으로 수용(S52, v0.9.0 예정).
  에디터 워크로드 성능 검증 후 이행 예정.
- [#42](https://github.com/tensorbee/rdocx/issues/42)·[#43](https://github.com/tensorbee/rdocx/pull/43)
  — 밀집 서식(중첩 표·세로 병합·exact 행·표 스타일) 레이아웃 수정 7건
  → 업스트림 S53 **F-X048**(Dense form table fidelity)로 편성, v0.9.0
  릴리스 노트 크레딧 예정.
- [#23](https://github.com/tensorbee/rdocx/issues/23) — 글리프 중복 진단
  → F-X041로 수정·종결 (진단·테스트 케이스 크레딧).

## 로드맵

PoC 단계(뷰어 → 편집 MVP → 증분 레이아웃/IME → 실문서 검증)는 완료.
현재는 본격 구현 단계 — [`docs/01-roadmap.md`](docs/01-roadmap.md):
M0 제품 골격 → M1 에디터 완성도 → M2 문서 기능 → M3 제품화.

## 진행 방식

rhwp의 방법론을 따릅니다: AI 페어 프로그래밍 + **사람이 매 단계를 확인하는
검증 우선 진행**. 모든 단계는 실측 증거(수치·스크린샷)와 함께
`docs/worklog/`에 기록되고, 사용자 확인 후 다음 단계로 넘어갑니다.
규칙은 [`CLAUDE.md`](CLAUDE.md)에 있습니다.

## 라이선스

MIT OR Apache-2.0 (rdocx 생태계와 동일)

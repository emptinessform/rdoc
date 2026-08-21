# rdoc

**서버 없이 브라우저에서 도는 경량 Rust/wasm DOCX 뷰어·에디터** (개발 초기 단계)

[rhwp](https://github.com/edwardkim/rhwp)("모두의 한글")가 HWP에서 증명한 것을
DOCX에서 재현하는 프로젝트입니다. 차이점: DOCX는 파서·레이아웃 엔진이
오픈소스 [rdocx](https://github.com/tensorbee/rdocx)로 이미 존재하므로,
이 프로젝트는 **그 위에 브라우저 렌더러와 에디터 계층을 쌓는 것**에 집중합니다.

## 왜

- 기존 브라우저 DOCX 편집기는 서버가 필요하거나(OnlyOffice, Collabora),
  wasm이어도 거대합니다(ZetaOffice ~1GB). 이 프로젝트의 wasm은 현재
  **10.4MB (gzip 4.8MB)** 입니다.
- 결과물 SVG는 글리프가 벡터 패스로 내장된 자기완결 문서 —
  뷰어에 폰트가 없어도 동일하게 렌더링됩니다 (1페이지 gzip ~40KB).
- 한국어 조판(폰트 폴백·셰이핑)을 1급 요구사항으로 다룹니다.

## 현재 상태 (PoC 3단계 완료, 2026-08-21)

| 단계 | 내용 | 검증 결과 |
|---|---|---|
| PoC 1 | rdocx 레이아웃 출력 → SVG 렌더러 (네이티브) | rdocx PNG 백엔드와 시각적 일치, 한국어 셰이핑 포함 |
| PoC 2 | wasm 빌드: 브라우저에서 docx 파싱→조판→SVG | 데모 92.6ms, .docx 파일 36.6ms |
| PoC 3 | 히트테스팅 + 편집 루프 (클릭→커서→타이핑→재조판) | 키 입력당 21~27ms, 한국어 삽입·줄바꿈 재계산 확인 |

코드는 [`rdocx-svg-poc/`](rdocx-svg-poc/), 상세 기록은
[`docs/worklog/`](docs/worklog/)에 있습니다.

## 실행

```bash
# 네이티브 (시스템 폰트 사용): out/에 SVG + 참조 PNG 생성
cd rdocx-svg-poc && cargo run --release

# wasm 에디터 데모
wasm-pack build --release --target web --out-dir web/pkg -- --no-default-features
# 한국어 폰트 준비 (저장소에 포함하지 않음 — 라이선스):
#   Windows: cp /c/Windows/Fonts/malgun.ttf web/
#   또는 Noto Sans KR 등 자유 라이선스 폰트를 web/malgun.ttf로
cd web && python -m http.server 8741   # → http://localhost:8741
```

## 업스트림 관계

rdocx에 두 가지를 제안/보고했고, 수용될 때까지
[포크 브랜치](https://github.com/emptinessform/rdocx/tree/svg-poc)를 의존합니다:

- [tensorbee/rdocx#37](https://github.com/tensorbee/rdocx/issues/37) —
  `Document::layout()` / `layout_with_fonts()` 공개 API 제안 (패치 보유, PR 의사 전달)
- [tensorbee/rdocx#23](https://github.com/tensorbee/rdocx/issues/23) —
  글리프 중복 버그에 진단 코멘트 (줄바꿈 후보 지점과의 상관관계 + 최소 재현)

## 로드맵

[`docs/01-roadmap.md`](docs/01-roadmap.md) — 단계별 검증 게이트를 통과하며
진행합니다: 읽기 전용 뷰어 → 편집 MVP → 증분 레이아웃/IME → 협업.

## 진행 방식

rhwp의 방법론을 따릅니다: AI 페어 프로그래밍 + **사람이 매 단계를 확인하는
검증 우선 진행**. 모든 단계는 실측 증거(수치·스크린샷)와 함께
`docs/worklog/`에 기록되고, 사용자 확인 후 다음 단계로 넘어갑니다.
규칙은 [`CLAUDE.md`](CLAUDE.md)에 있습니다.

## 라이선스

MIT OR Apache-2.0 (rdocx 생태계와 동일)

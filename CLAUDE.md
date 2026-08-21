# rdoc 프로젝트 진행 규칙

경량 Rust/wasm DOCX 뷰어·에디터. rhwp의 방법론(AI 페어 프로그래밍 + 검증
우선 + 투명한 기록)을 따른다.

## 단계적 진행 (핵심 규칙)

1. **단계 시작 전**: 이번 단계의 목표·범위·검증 기준을 짧게 제시한다.
2. **구현**: 범위를 벗어나는 확장은 하지 않는다. 발견한 문제는 기록하고
   범위에 넣을지 사용자에게 묻는다.
3. **검증**: 주장하지 말고 실측한다 — 네이티브는 실행 출력, 브라우저는
   헤드리스 스크린샷/타이밍. 실패·한계도 그대로 기록한다.
4. **기록**: `docs/worklog/YYYY-MM-DD.md`에 무엇을 했고 어떻게 검증했는지
   증거(수치, 스크린샷 경로, 커밋)와 함께 남긴다. 중요한 설계 선택은
   `docs/decisions.md`에 추가한다.
5. **확인 게이트**: 단계가 끝나면 결과를 보고하고 **사용자 확인을 받은 뒤**
   다음 단계로 넘어간다. 확인 없이 다음 단계를 시작하지 않는다.

## 빌드·검증 명령

```bash
# 네이티브 PoC (시스템 폰트): out/에 SVG + 참조 PNG + hits.json
cd rdocx-svg-poc && cargo run --release --bin poc

# wasm 빌드
wasm-pack build --release --target web --out-dir web/pkg -- --no-default-features

# 웹 데모 서버 (web/에서): 한국어 폰트를 web/malgun.ttf로 먼저 복사
python -m http.server 8741
```

브라우저 검증은 헤드리스 브라우저(browse 스킬)로 자동화한다.
페이지의 `window.__t` 훅: `clickAt(page,x,y)`, `type(s)`, `backspace()`,
`state()`. 좌표는 SVG viewBox 좌표(pt)이며 `out/hits.json`에서 얻는다.

## 업스트림 관계 (tensorbee/rdocx)

- 의존: 포크 `emptinessform/rdocx` 브랜치 `svg-poc` (rev 고정, Cargo.toml).
  패치 내용: `Document::layout()`, `layout_with_fonts()` 공개.
- 열린 제안/이슈: #37 (layout API 제안, PR 의사 전달됨), #23 (글리프 중복
  버그 — 줄바꿈 후보 지점 상관관계 진단 코멘트 게시됨).
- 업스트림에 변화가 있으면(답변, 수정) 포크 리베이스와 rev 갱신을 검토하고
  worklog에 기록한다. 업스트림 게시(이슈·PR·코멘트)는 사용자 확인 후 한다.

## 알려진 한계 (백로그 후보)

- 문서 위치 역매핑이 텍스트 매칭 우회 — 표 셀·마커는 편집 불가. 근본 해결은
  업스트림 레이아웃의 source provenance (#37 후속).
- IME 조합 입력 미처리 (완성 문자열 삽입만 검증됨).
- 키 입력당 전체 재레이아웃 (1페이지 21~27ms) — 대형 문서에는 증분 레이아웃 필요.
- `malgun.ttf`는 MS 라이선스라 저장소에 포함 금지. 재현 시 로컬 복사 또는
  자유 라이선스 한국어 폰트 사용.

## 커밋 규칙

- 단계 단위로 커밋, 메시지는 영어, 본문에 검증 결과 요약.
- 생성물(target/, out/, web/pkg/, 폰트)은 커밋하지 않는다 (.gitignore).

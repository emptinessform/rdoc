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
# 워크스페이스 루트에서 실행. 구조: crates/rdoc-core (코어) + web/ (앱)
# 네이티브 (시스템 폰트): out/에 SVG + 참조 PNG + hits.json
cargo run --release -p rdoc-core --bin poc

# wasm 빌드
wasm-pack build crates/rdoc-core --release --target web --out-dir ../../web/pkg -- --no-default-features

# 웹 앱 빌드: 소스는 web/src/*.ts (TypeScript), web/js/는 tsc 산출물
cd web && npm install && npm run build   # tsc -p .

# 웹 데모 서버 (web/에서): 한국어 폰트를 web/malgun.ttf로 먼저 복사
python -m http.server 8741

# 브라우저 테스트 스위트: web/tests/ (실행 규약은 web/tests/README.md)
```

브라우저 검증은 헤드리스 브라우저(browse 스킬)로 자동화한다.
페이지의 `window.__t` 훅: `clickAt(page,x,y)`, `type(s)`, `backspace()`,
`state()`. 좌표는 SVG viewBox 좌표(pt)이며 `out/hits.json`에서 얻는다.

## 업스트림 관계 (tensorbee/rdocx)

- 기반: 업스트림 v0.8.0 (F-X032 layout API, F-X037 provenance, F-X038 캐시).
- 의존: 포크 `emptinessform/rdocx` 브랜치 `svg-poc-0.8` (rev 고정,
  Cargo.toml; 로컬 클론 D:\sb\SBDoc\rdocx-fork). v0.8.0 위 리뷰 경계별
  분리 커밋: S2 편집 헬퍼, 번들 폴백 진입점, Arc 타입 브레이크(F-X039
  후보), 재시작 페이지네이션+표/HF 캐시(F-X040 후보), 폴백 엔진
  유지+핸드오프, F-X038 튜닝, 미주 타입 필드 승격·노트/표/이미지 편집
  API, dense-form 레이아웃 수정(중첩 표·vMerge·exact 행·표 스타일
  캐스케이드·셀 앵커), caller 폰트 family 별칭(FontFile.family 존중 —
  업스트림 보고 후보). 구 브랜치 `svg-poc`(pre-0.8.0)와 `perf-caches`는
  참고용 유산.
- 업스트림 상태 (2026-08-23): #39/#40/#41 종결 — 성능 작업은 S52
  F-X039/40/43~47 강화판으로 수용 (v0.9.0·rpptx-v0.5.0 릴리스 노트
  크레딧 예정). #42/#43은 S53 **F-X048**(Dense form table fidelity)로
  편성 — PR #43은 머지 대신 S52 엔진 위 재구현, F-X048 착지 시
  "addressed"로 종결 예정 (v0.9.0 마일스톤; 그때까지 open 유지).
  #23 종결 — F-X041(27a9802), 우리 진단·테스트 케이스 크레딧.
  s52 이행은 에디터 성능 회귀(타이핑 2.4×, 노트 ~10×)로 보류 —
  피드백 초안은 docs/upstream/에 보관(미게시). **2026-08-23 점검:
  sprint/s52가 main에 머지됨**(v0.9.0 태그·s53 브랜치는 아직) —
  피드백 게시 재결정 시점 도래 (수치 재검증 필요, 머신 유휴 대기).
  **#44 → PR #45**: FontFile.family 버그 보고 후 업스트림 요청으로
  rodf 측이 PR #45 게시(포크 브랜치 pr/fontfile-family — post-S52
  main 리베이스, 테스트 231/0, 머지 시 #44 종결). **리뷰 대응은
  rdoc 담당** (2026-08-23 사용자 지시) — 점검 시 PR #45 리뷰 확인.
  게시 초안·URL 기록은 docs/upstream/.
- 업스트림에 변화가 있으면(답변, 수정) 포크 리베이스와 rev 갱신을 검토하고
  worklog에 기록한다. 업스트림 게시(이슈·PR·코멘트)는 사용자 확인 후 한다.

## 알려진 한계 (백로그 후보)

- 역매핑은 F-X037 소스 맵 기반. 6개 스토리 전부 텍스트 편집, Enter/병합은
  본문·표 셀·머리글·꼬리글·각주에서 동작 (미주와 경계 프로젝션 문단은
  거부). 각주 추가/삭제는 Ctrl+Alt+F/D. 미주 조작·셀 간 선택 편집은
  미지원.
- 문단 삽입/삭제(Enter/병합)는 소스 노드 테이블이 바뀌어 페이지네이션
  캐시 전체 폴백 (타이핑은 증분).
- 프리에딧 밑줄은 오버레이 전용 (문서 서식 아님 — 의도된 설계).
- `malgun.ttf`는 MS 라이선스라 저장소에 포함 금지. 재현 시 로컬 복사 또는
  자유 라이선스 한국어 폰트 사용.

## 커밋 규칙

- 단계 단위로 커밋, 메시지는 영어, 본문에 검증 결과 요약.
- 생성물(target/, out/, web/pkg/, 폰트)은 커밋하지 않는다 (.gitignore).

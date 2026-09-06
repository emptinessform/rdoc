# 2026-09-07 — S62: 이름 정리와 문서 다국어 구조

업스트림 메인테이너가 #67에 남긴 두 가지("이번 주에 #67을 보겠다",
"문서 영문판도 계획이 있나")에 답하면서 시작한 단계.

## 0. 업스트림 응답 (#67)

메인테이너 코멘트(2026-09-06 18:16)는 이미 자기들이 v0.12.0에서 고친
#67을 다시 보겠다는 내용이었다. GitHub 실제 상태를 확인하니 #65/#66은
CLOSED, **#67은 아직 OPEN**이고 #69에는 응답이 없다. 사용자 확인 후
[#67에 코멘트](https://github.com/tensorbee/rdocx/issues/67#issuecomment-5560088609)
를 달았다 — F-X075로 종결 가능하다는 근거(재시작 레코드 발행·재사용,
타이핑 ~2.4배)와 살아 있는 이슈는 #69라는 안내, 그리고 S61 세 수정의
요약. 영문판 질문에는 "문서·제품 모두 한/영 2본으로 간다"고 답했다.

## 1. 이름 — "poc"를 현재형에서 걷어내기

`poc`가 붙어 있던 실행 파일은 편집기가 아니라 DOCX를 네이티브 폰트로
조판해 `out/`에 SVG·참조 PNG·`hits.json`을 떨구는 검증 도구다. 그래서
셋으로 갈랐다 (decisions D6):

| 자리 | 전 | 후 |
|---|---|---|
| 네이티브 바이너리 | `--bin poc` | `--bin render` |
| 웹 패키지 | `rdoc-web` | `rdoc-editor` |
| 제품 이름 | 혼용 | **rdoc editor** (데모 `<title>`에 이미 있던 이름) |
| PDF 산출물 | `out/poc.pdf` | `out/render.pdf` |
| 포크 브랜치 | `svg-poc-0.12` | 유지 (업스트림 이슈 본문이 이 이름으로 참조) |

산문의 "PoC"도 걷었다: `lib.rs`/`main.rs`/`repro.rs`의 주석, 데모 문서의
제목 문자열(`"rdocx SVG Rendering PoC"` → `"rdocx SVG rendering demo"`)과
마지막 줄(`"— end of PoC page —"` → `"— end of demo page —"`),
로드맵의 "PoC 1~3" → "프로토타입 1~3", knowledge 13절 제목. 과거
워크로그의 "PoC"는 기록이라 그대로 뒀다.

### 검증

개명 전 산출물 해시를 떠 두고 개명 후 다시 렌더해 비교했다.

```
before: page-1.svg 609c5754  page-2.svg 95e45ad7  hits.json 6a8430aa
after : page-1.svg c53f03f7  page-2.svg 95e45ad7  hits.json 6195b0ea
```

`page-2.svg`는 **바이트 동일**, 바뀐 건 데모 문구가 있는 page-1과 그
좌표를 담은 hits.json뿐 — 렌더 경로 자체는 안 건드렸다는 뜻이다.
히트 수는 272로 불변. `cargo test -p rdoc-core` 9/9 통과.
`npm run build`(tsc) 통과.

## 2. 문서 — docs/ko + docs/en 미러

사용자 결정: 미러 트리, 소급은 지속 문서까지 (decisions D6).

```
docs/
  ko/   01-roadmap.md  decisions.md  knowledge.html  worklog/  upstream/
  en/   01-roadmap.md  decisions.md  knowledge.html  worklog/
  evidence/            (스크린샷 — 언어 중립)
```

기존 파일은 `git mv`로 옮겼고(워크로그끼리의 상대 링크는 같은 디렉터리라
그대로 유효), README·CLAUDE.md·업스트림 초안의 인바운드 링크 11곳을
갱신했다. CLAUDE.md에는 "다국어 규칙" 절을 새로 넣었다 — 새 문서는 두
곳 모두에, UI 문자열은 `web/src/i18n/`으로만, 업스트림 게시는 영어로.

영문본 3종을 새로 썼다: `decisions.md`(D1~D6), `01-roadmap.md`,
`knowledge.html`(13절 19,000자 — 인라인 SVG 도해의 텍스트까지 옮기고
본문 폰트 스택만 시스템 폰트로 바꿨다). 두 파일 모두 13개 절이 다 있고
DOCTYPE·`</html>`이 닫히며 블록 태그 균형이 맞는지 스크립트로 확인했다.

## 3. README 정정

낡은 사실을 실측치로 바꿨다.

| 항목 | 전 | 후 |
|---|---|---|
| 포크 브랜치 | svg-poc-0.8 (v0.8.0) | svg-poc-0.12 (v0.12.0) |
| wasm 크기 | 10.9MB (gzip 5.0MB) | 17.5MB (gzip 8.9MB) |
| 브라우저 스위트 | 34종 | 50종 |
| 타이핑 성능 | min 23ms | min 12ms |
| 업스트림 이슈 목록 | #40~#44 (v0.9.0 예정) | #65~#69 현재 상태 |
| 상태 날짜 | 2026-08-23 | 2026-09-07 |

wasm 크기는 `web/pkg/rdoc_core_bg.wasm` 17,535,635바이트를 gzip -6으로
직접 재서 얻었다.

## 4. 브라우저 게이트

데모 문서 문자열이 바뀌었으므로 wasm을 다시 빌드하고(17,535,635 →
17,539,356바이트, +3,721) `browse restart` 후 배터리를 돌렸다.

```
TOTAL: 50 PASS, 0 FAIL
```

문구 변경이 히트 경로에 영향을 주지 않았음을 뜻한다 — 테스트가 좌표를
`hitFor(경로)`로 런타임에 얻기 때문에 글자 폭이 바뀌어도 따라간다.
`ux4-test.js`의 낡은 주석("— end of PoC page —")만 새 문구로 고쳤다.

## 남은 것

- **S63**: 제품 UI i18n (`web/src/i18n/`, index.html 127줄 + TS 60줄).
- 포크 브랜치 개명은 다음 업스트림 이행 때.
- 과거 워크로그 77개는 한국어 원본만 유지 (D6).

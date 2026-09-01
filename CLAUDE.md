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
python serve.py   # http.server 8741 + no-cache (모듈 캐시 방지)
# ⚠ wasm/pkg 재빌드 후에는 browse restart (렌더러 메모리 캐시)

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
  캐스케이드·셀 앵커), caller 폰트 family 별칭(#44/PR #45로 업스트림
  제출), 리스트/링크/셀 병합/그리드 게터/본문 항목 이동(move_content)/
  이미지 리사이즈(resize_inline_image) 등 에디터 지원 API. SBOdf도
  같은 브랜치에 커밋한다(탭 스톱 등).
  구 브랜치 `svg-poc`(pre-0.8.0)와 `perf-caches`는 참고용 유산.
- 업스트림 상태 (2026-09-01): **v0.11.1 출시**. #53(각주 게이트)은
  F-X062(cdf524b), #54(폰트 바이트 비교)는 F-X063(29f872e)로 처리 —
  둘 다 종결, CHANGELOG에 링크·크레딧. **S57 스파이크 결과 이행 3회째
  보류**: 기능 완전 등가(배터리 50/50, 코퍼스 14/14, 히트 272, 58p)이고
  포크 커밋은 하나도 더 못 줄이는데, 브라우저 7회 교대 A/B에서 **타이핑
  1.24×(7/7 페어 전패, 부호검정 p≈0.008)**·로드 1.26×·wasm 12→17 MB.
  **개선된 것**: undo 2.15× 회귀 소멸(1.03×), 머리글/꼬리글 절벽 해소,
  `RESTART_CACHE_MAX_ENTRIES` 32→1,024, #54 확인(폰트 비용 +8→+7 ms).
  **남은 것**: (1) **각주 절벽 잔존** — 미변경 각주 1개가 편집 지점에서
  340문단 밖에 있어도 6→16~25 ms(bench2, 머리글/꼬리글은 6 ms로 대조);
  (2) **번들-폴백 경로 1.5×** — `layout_with_fonts_aliases_and_bundled_
  fallback`이 폰트·별칭과 무관하게 63p에서 52 vs 31 ms인데 같은 문서를
  `doc.layout()`로 재면 대등(16~22 vs 17~19) → S58의 bidi/셰이핑/하이픈
  고정 비용으로 추정했으나 **원인 규명 완료**.
  **원인 (S57 후속, systematic-debugging)**: (1) 각주 절벽은
  페이지네이션이 아니라 **문단 캐시 poison** — 캐시 비안전 블록을 만나면
  `engine.rs`가 `paragraph_cache_reads_enabled = false`로 레이아웃
  나머지 전체의 캐시를 끄고, `paragraph_is_cache_safe`가 Text/Tab/Break만
  허용해 각주 참조 문단이 탈락한다 (키당 hits +699/builds +1 →
  hits +10/builds +689; 그 한 줄만 빼면 15~17 → 4~6 ms). **F-X062는
  정상 작동** — 각주가 있어도 재시작 플래그·체크포인트·paginate 0.1 ms가
  동일하다. (2) 재시작이 **산문 문서에서 아예 안 켜진다** —
  `lines.len() <= 2 && heading/keep` 조건을 `all()`로 문서 전역 요구
  (715 중 701 탈락, 줄 수만 풀면 제목 1개가 남아 여전히 실격) + 
  `RESTART_CACHE_MAX_BYTES = 8 MiB`인데 58페이지 후보가 25.1 MB(총 64 MiB
  중 문단 캐시가 50 MiB를 가져간 나머지). **진입점 무관** —
  `doc.layout()`도 4줄 문단이면 30~33 vs 0.8의 21~22 ms
  (S56의 "4줄 문단 1.3× 철회"는 성급했다; 페어 측정으로 일관).
  둘 다 풀면 21~28 ms로 0.8(31~39)보다 빠르지만, 브라우저 3방향 A/B에서
  **Enter가 116 → 315 ms(2.7×)** 악화해 포크 패치로는 순손해다
  (게시 비용 아님 — 25 MB 게시가 0.6~0.9 ms; 원인 미규명).
  **이슈 게시**(2026-09-01): **#65**(문단 캐시 poison),
  **#66**(재시작 게이트+예산) → 응답 대기. **0.8 핀에는 두 문제가 모두
  없으므로 rdoc에서 지금 고칠 것은 없다.** 진단 브랜치
  `exp/v0111-diag`(8b9e83a, RDOC_DIAG + 오버라이드 4종),
  실험 브랜치 `exp/v0111-gates`(4812a2a).
  포크 `svg-poc-0.11`(c8dbdc9), rdoc `s57-v0111-spike`, 적응 패치
  docs/upstream/2026-09-01-rdoc-v0111-adaptation.diff. rdoc 적응은
  **v0.10.1 적응 그대로, 추가 수정 0줄**.
  ⚠ 측정 규약: 이 머신은 같은 빌드 편차가 ±30%(v0.8 타이핑 min 60~82)라
  단발 비교는 무의미하다. 브라우저 A/B는 pkg 2벌을 보관해 **한 세션 내
  교대로 여러 라운드**를 돌리고 **페어 승패**로 판정할 것.
  경위: v0.9.0(S55)·v0.10.1(S56) 보류 기록은 docs/worklog/ 참조.
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

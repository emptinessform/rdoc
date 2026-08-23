# 2026-08-23 — S24: 온라인 데모 v0 (GitHub Pages)

## 목표·범위

rhwp처럼 "무료, 설치 없이" 열리는 공개 데모를 GitHub Pages에 올린다
(개발 프리뷰로 조기 공개, UI 셸 개편은 M1). 범위: 자유 폰트 다단 로딩,
열기 오류 가드, Actions→Pages 배포, README 링크.

## 한 일

- **폰트 다단 로딩** (main.js `addFirstFont`): ① 로컬 `malgun.ttf`
  (개발 편의 — MS 라이선스, 저장소 밖) → ② 데모 폰트
  `fonts/Pretendard-Regular.otf`(SIL OFL 1.1, 1.5MB)를 "Pretendard" +
  "Malgun Gothic" + "맑은 고딕" 패밀리로 등록 → ③ 둘 다 없으면 rdocx
  번들 폴백. 캐럿 우선순위는 caller 폰트가 최상위라 기존 로컬 동작
  불변.
- **열기 오류 가드**: 파일 input의 `load_docx`를 try/catch로 감싸
  실패 시 status에 `열기 실패: 파일명 — 원인` 표시, input value 리셋
  (같은 파일 재시도 가능).
- **배포**: `.github/workflows/pages.yml` — main 푸시마다 wasm-pack
  빌드 → site/ 조립(index.html + js/ + pkg/) + Pretendard를 CI에서
  다운로드(저장소 미커밋, .gitignore `web/fonts/`) → Pages 배포
  (configure-pages enablement:true로 첫 배포 시 Pages 자동 활성화).
- README 최상단에 온라인 데모 링크.

## 검증 (실측)

- malgun.ttf 제거 상태에서 데모 로드: 한국어 전 문단 Pretendard로
  정상 셰이핑(한글 세그먼트 adv 9.5pt, 스크린샷
  docs/evidence/s24-demo-pretendard.png), status ready → 2/2 렌더 48.6ms.
- 손상 docx(4바이트 쓰레기): `load_docx`가 JS 예외로 도달
  ("OPC package error: ZIP error…") — 가드가 감싸는 바로 그 호출임을
  훅으로 확인.
- malgun 복원 후 러너 스모크 5종(ime/cellsel/img/thumbs/repl) PASS.
- CI/URL 검증은 푸시 후: Actions 그린 + https://emptinessform.github.io/rdoc/
  로드 확인 예정 (결과 이 파일에 추기).

## 메모

- 데모 문서엔 "Load demo" 버튼 클릭이 필요 — 자동 로드/샘플 갤러리는
  M1 UI 셸 단계 후보.
- wasm 10.9MB(gzip 5.0MB) + 폰트 1.5MB — Pages에서 수용 가능한 초기
  로드.

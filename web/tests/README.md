# 브라우저 테스트 스위트

헤드리스 브라우저(browse 스킬)로 실행하는 검증 스크립트 모음.
각 스크립트는 페이지에 주입되어 `window.__t` 훅으로 에디터를 조작하고,
결과를 `window.__benchResult`에 `{"ok":true|false, "fails":[...]}` JSON으로
남긴다.

## 실행 방법

```bash
# 0) 앱 빌드 + 서버 (워크스페이스 루트의 web/에서; 한국어 폰트를
#    web/malgun.ttf로 먼저 복사). 소스는 web/src/*.ts — web/js/는 tsc
#    산출물이므로 소스 수정 후 반드시 재빌드.
npm install && npm run build
python -m http.server 8741

# 1) 러너 — 전체 배터리 (PASS/FAIL 집계, 실패 시 종료 코드 1)
bash web/tests/run.sh

# 부분 실행 (접미사 -test.js 생략 가능)
bash web/tests/run.sh ime paste

# 환경 변수: RDOC_URL(기본 http://localhost:8741),
#            RDOC_TEST_SLEEP(기본 16초), BROWSE_BIN(browse 바이너리)
```

러너 없이 한 스위트를 수동 디버깅할 때:

```bash
# 스크립트는 /tmp 아래에 있어야 browse eval이 읽는다.
# 캐시 버스트 URL로 접속 → 주입 → 폴링 없이 대기 → 결과 읽기.
cp web/tests/ime-test.js /tmp/
B=~/.claude/skills/gstack/browse/dist/browse
"$B" goto "http://localhost:8741/index.html?v=run1"
"$B" eval /tmp/ime-test.js
sleep 16                       # 무거운 wasm 동기 작업 중 폴링 금지
"$B" js "window.__benchResult"
```

## 규약

- 데모 문서 기준(`Load demo` 클릭). bench-*.js만 `web/bench.docx`
  (63페이지) 사용.
- `window.__t` 훅 목록은 index.html의 `window.__t = {...}` 참조.
- 좌표는 SVG viewBox 좌표(pt). 한글 히트는 음절 세그먼트(1~2자)로
  쪼개지므로 오프셋→좌표는 해당 오프셋을 덮는 세그먼트로 계산할 것
  (notesel-test.js의 `xAt` 패턴).
- wasm-bindgen `Option` None은 JS `undefined` — 비교는 `== null`.
- 데모 문서가 바뀌면(문단 추가 등) 경로 상수(d/4, d/10.1.0.0 등)를
  함께 갱신해야 한다.

## 스위트 개요

| 파일 | 대상 |
|---|---|
| ime-test / preedit-test | IME 조합, 프리에딧 밑줄, undo 단위 |
| cell-test / hf-test / note-test / en-test | 표 셀·머리글/꼬리글·각주·미주 편집 |
| split-test / empty-test | Enter/병합(5스토리), 빈 문단 캐럿 |
| noteops-test / enops-test | 각주/미주 삽입·삭제 (Ctrl+Alt+F/E/D) |
| roundtrip-test | .docx 저장 왕복(6스토리 편집 보존) |
| ux-test / ux2-test / ux3-test / ux4-test | 방향키·Home/End·Ctrl+A·더블/트리플클릭·스크롤 |
| shift-test | Shift+화살표/Home/End/클릭 선택 |
| cellsel-test / notesel-test | 문단 간·셀 간 선택 편집, 마커 동반 삭제 |
| find-test / repl-test | 찾기(Ctrl+F), 바꾸기(Ctrl+H, 모두=1 undo) |
| paste-test / cut-test | 붙여넣기(멀티라인 1 undo), 잘라내기 |
| align-test / fontsize-test / biu-test | 정렬·크기·B/I/U (임의 선택) |
| fonts-test | 오픈 폰트 별칭 매핑 (fontmap-test.docx: 굴림→산세리프, 바탕/궁서→세리프) |
| bench-undo / bench-web2 | 성능(키 입력·구조 연산, 63페이지) |

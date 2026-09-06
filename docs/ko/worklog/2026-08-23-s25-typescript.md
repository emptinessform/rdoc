# 2026-08-23 — S25: 웹 앱 TypeScript 전환

## 목표·범위

사용자 요청(rhwp처럼 TS 기반 관리)에 따라 `web/js/*.js`(수기)를
`web/src/*.ts` + `tsc` 컴파일 구조로 전환. **번들러 없음** — 출력은
지금과 동일한 ES 모듈이 `web/js/`에 나오므로 서빙·테스트·배포 구조
불변. 로직 변경 없음(strict가 요구하는 가드/캡처는 동작 등가로만).

## 구성

- `web/package.json`(typescript 5.9.2 devDependency, `npm run build` =
  `tsc -p .`) + `web/tsconfig.json`(strict, ES2022, rootDir src →
  outDir js). `web/js/`와 `node_modules/`는 gitignore (산출물).
- wasm 타입은 wasm-pack이 생성하는 `web/pkg/rdoc_core.d.ts`를 그대로
  import — SvgConverter 전 API가 타입화됨 (Option → `string |
  undefined` 등).
- 공유 계약을 `state.ts`에 명시: `HitRun`(page/id/path/start/text/
  x/y/size/adv), `Pos`/`Ref`/`Sel`/`Comp`/`ImageSel`, `State`.
  `edit.ts`에 `ParaRange`/`SelRange`(kind 판별 유니온), `view.ts`에
  `Vis`, `render.ts`에 `RenderDelta`, `input.ts`에 `DragState`.
- strict가 강제한 정리(전부 동작 등가):
  - 클로저 내 `S.caret` 접근을 로컬 캡처(`const c = S.caret`)로 —
    같은 객체 참조라 변이 의미 불변.
  - `setAttribute(k, 숫자)` → `String(...)` (JS 암묵 문자열화와 동일).
  - `h.start + k`의 null 암묵 0-강제 → `(h.start ?? 0) + k`로 명시.
  - `findq._t` 디바운스 익스팬도 → 모듈 로컬 타이머 변수.
  - 호출자가 보장하던 캐럿 전제(`forwardDelete` 등)에 명시적 가드.
- Pages 워크플로에 Node 22 + `npm ci && npm run build` 단계 추가
  (wasm 빌드 뒤 — d.ts가 먼저 있어야 타입 체크 통과). CLAUDE.md /
  README / tests README에 빌드 단계 반영.

## 검증 (실측)

- `tsc -p . --noEmit` 에러 0 (초기 642 → 0, strict).
- 전체 배터리 (tsc 산출물 서빙): **32/32 PASS** — 스위트 무수정.

## 사고·교훈

- 패치 스크립트에서 한국어를 \\u 이스케이프로 손타이핑하다 1자
  오타('럿' U+B7FF를 B7BF로)로 치환 실패 — 원문 문자열을 건드리지
  않는 ASCII 앵커로 패치하는 쪽이 안전.

## 메모

- `S.conv`는 non-null 타입 (main.ts에서 init 직후 1회 대입 — 사용
  시점엔 항상 존재). 초기화는 `null as unknown as SvgConverter`.
- 다음 후보: 사용자 지시된 **오픈 폰트 세트 구성**(S26) — Pretendard
  외 Noto Serif KR 등 OFL 폰트를 상용 패밀리명(바탕/명조 등)에 매핑,
  모바일 등 로컬 폰트 없는 환경 대응.

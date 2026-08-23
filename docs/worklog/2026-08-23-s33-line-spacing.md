# 2026-08-23 — S33: 줄 간격 (M1)

## 목표·범위

문단 줄 간격(배수 1.0/1.15/1.5/2.0) — 툴바 드롭다운 + 서식 메뉴,
캐럿 문단 또는 선택이 닿는 문단 전체에 1 undo.

## 한 일

- 업스트림 `Paragraph::set_line_spacing_multiple`(auto 룰, 240분율)이
  이미 있어 **포크 무수정**. rdoc `set_line_spacing_at`(0.5~10 배수
  가드) + wasm `set_line_spacing_paths`(경로 배열, 1 undo).
- UI: 툴바 `#linespacing` 드롭다운(줄간격/1.0/1.15/1.5/2.0), 서식
  메뉴 3항목. 줄 간격은 리플로우라 선택은 시작 캐럿으로 붕괴 —
  리스트 토글과 공용 헬퍼 `selectedParagraphPaths()`로 추출(중복
  제거). `__t.lineSpacing` 훅.

## 검증 (실측)

- 신규 spacing-test 7단정: d/3(2줄 문단)의 베이스라인 피치 실측 —
  2.0 적용 시 피치 1.8~2.2×, 캐럿 생존, undo 1회 복원, 형제 선택
  1.5 적용(1 undo, 1.35~1.65×), 저장 왕복 보존.
- 전체 배터리 **37/37 그린** (플레이크 0), 네이티브 lib 9/9 +
  corpus 14/14.

## 한계·후속

- 문단 앞/뒤 간격(spacing before/after)과 툴바의 현재값 표시는 후속.
- exact/atLeast 룰(pt 고정 간격)은 UI 미노출 (코어는 지원).

# 2026-08-23 — S28: B/I 실효 렌더링 (데모 버그 신고)

## 배경

사용자 신고: 온라인 데모에서 Bold/Italic이 "안 됨". 진단 —
서식은 문서에 적용되고 있었음(fmtOn true, 저장 왕복도 통과)에도
**시각 변화가 0**: 배포(Pretendard/나눔명조)와 로컬(malgun) 폰트가
전부 Regular 단면뿐이라, bold/italic 해석이 같은 Regular face로
떨어짐. 데모의 영문 "bold"만 굵었던 건 번들 Carlito-Bold 덕.
기존 biu-test는 문서 상태만 단정하고 시각을 안 봐서 통과해 왔음.

## 수정

1. **합성 볼드/이탤릭 (rdoc SVG 렌더러)**: GlyphRun에는 요청
   스타일(bold/italic)이 있고, FaceInfo에 실제 face의 OS/2
   bold/italic을 저장. 불일치 시에만 합성 — 볼드는 그룹에 동색
   stroke(0.03em), 이탤릭은 glyph transform에 skewX(-12°) (translate
   뒤·scale 앞이라 베이스라인 기준 기울임). Word의 CJK 처리와 동일
   접근. 어드밴스는 불변(히트테스트 영향 없음).
2. **실물 Bold 단면 배포**: Pretendard-Bold.otf(1.6MB) +
   NanumMyeongjo-Bold.ttf(3.1MB)를 같은 family로 추가 등록 — fontdb가
   파일에서 weight를 읽어 bold 쿼리에 진짜 볼드 face를 반환, 합성은
   폴백으로만 동작. CI 다운로드 + 로더 FONT_SOURCES 추가.
3. **biu-test에 시각 단정 추가**: 굵게 후 (stroke 존재 ∨ 글리프 href
   변화), 기울임 후 (skewX ∨ href 변화) — 실물/합성 어느 경로든
   시각 변화를 강제. "문서 상태만 검증하고 화면을 안 본" 구멍을 메움.

## 검증 (실측)

- 스크린샷 docs/evidence/s28-bold-italic.png — 한국어 "달려
  있습니다" 실물 볼드, "그리고 이 문장" 합성 기울임.
- biu-test(시각 단정 포함)·fonts-test PASS, 전체 배터리 **33/33
  그린** (img 1회 무결과 플레이크 → 재시도 PASS).
- 네이티브 lib 9/9, corpus 14/14.

## 한계·메모

- 이탤릭은 한국어 폰트 생태계에 단면이 없어 항상 합성 (Word 동일).
- 폰트 5파일(총 ~14MB)이 매 레이아웃 input으로 복제되는 비용은
  키 입력 +1~2ms 수준 — 근본 해결은 업스트림 F-X039(Arc) 계열,
  s52 이행 시 자연 해소.
- 합성 볼드 두께 0.03em은 1차 근사 — 필요시 조정.

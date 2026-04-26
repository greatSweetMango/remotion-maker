---
title: "ADR-0001: 편집과 렌더를 분리한다"
created: 2026-04-17
updated: 2026-04-26
tags: [decision, area/edit, area/export]
status: accepted
---

# ADR-0001: 편집과 렌더를 분리한다

## 컨텍스트

AI 모션 에셋 생성 서비스에서 가장 큰 비용은 **렌더링**이다. 매 편집마다 서버 렌더가 발생하면:
- 원가가 폭증한다 (Lambda + LLM)
- UX가 느려진다 (수십 초 대기)
- 경쟁사(Jitter, LottieFiles)도 이 함정에 빠져 있다

## 결정

**편집 ≠ 렌더 아키텍처**를 채택한다.

- 편집 요청 시: LLM이 코드만 수정 → 브라우저 Remotion Player에서 즉시 재생 ($0)
- Export 시에만: Remotion Lambda로 실제 렌더 ($0.02~0.05/회)
- 커스터마이징 UI 조작도 동일: props 변경 → Player 즉시 반영

## 결과

- 편집 1회 원가: ~$0.007 (캐시 적용 LLM only) vs 경쟁사 ~$0.05+
- 편집 latency: <2초 (LLM round-trip만) vs 렌더 시 30~60초
- Pro $12 구독 마진 64% 확보 (PRD §8 원가 분석)

## 결과적 제약

- 브라우저 Player 성능이 사용자 체험을 결정 → A6 가정 검증 필요 (복잡도별 벤치마크)
- 코드 평가 보안 중요 → sandbox evaluator 필수 ([[../../02-dev/architecture#sandbox]])

## 관련

- 코드: `src/lib/remotion/evaluator.ts`, `src/components/studio/PlayerPanel.tsx`
- PRD: §4 (Unfair Advantage), §7 (Technical Architecture)

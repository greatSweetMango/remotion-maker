---
title: Product Overview — EasyMake
created: 2026-04-26
updated: 2026-04-26
tags: [pm]
status: active
---

# Product Overview

> 원본 PRD: `../../PRD.md` (수정 시 그쪽을 수정. 이 페이지는 요약/네비게이션 용도)

## 한 줄 정의

**Remotion + AI**로 모션 에셋을 만들고, **자동 생성된 커스터마이징 UI**로 즉시 조정해 export 하는 SaaS.

## 핵심 차별점

1. **동적 커스터마이징 UI 자동 생성** — 경쟁사 어디도 못 함. 핵심 해자.
2. **React 컴포넌트 export** — 프론트엔드 개발자 페르소나 직격
3. **편집 ≠ 렌더 아키텍처** — 편집은 LLM 코드 수정만, 렌더는 Export 시점에만 → 원가 90% 절감

자세한 비교: PRD §4 [Core Value Proposition](../../PRD.md#4-core-value-proposition)

## 타깃 페르소나

- **지현** (27세, 모션 디자이너) — AE 대안, AI 초안 + 세부 조정 워크플로우
- **재혁** (30세, 프론트 개발자) — React 컴포넌트로 바로 import

자세히: PRD §3

## 기능 영역 맵

| 영역 | 위키 태그 | 코드 위치 |
|---|---|---|
| AI 에셋 생성 | `area/generate` | `src/lib/ai/`, `src/app/api/generate/` |
| 동적 커스터마이징 UI | `area/customize` | `src/components/studio/CustomizePanel.tsx` |
| 편집 요청 (Re-prompt) | `area/edit` | `src/app/api/edit/` |
| Export | `area/export` | `src/app/api/export/`, Remotion Lambda |
| 템플릿 갤러리 | `area/templates` | `src/components/gallery/`, `src/remotion/templates/` |
| 인증 | `area/auth` | `src/app/(auth)/`, NextAuth.js v5 |
| 결제 | `area/billing` | `src/lib/stripe/`, `src/app/api/stripe/` |

## 가격 정책 (요약)

- **Free** — 월 3회 생성, GIF 워터마크
- **Pro $12/mo** — 월 200회, 전체 export 포맷, React 컴포넌트
- **Team $25/seat/mo** — 500회, ProRes/4K (v2)

자세히: PRD §8

## 관련 문서

- [[roadmap|Roadmap]]
- [[decisions/README|Decisions]]
- [[../02-dev/architecture|Architecture]]
- [[../02-dev/status|개발 현황]]

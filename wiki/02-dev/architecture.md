---
title: Architecture
created: 2026-04-26
updated: 2026-04-26
tags: [dev, area/infra]
status: active
---

# Architecture

## 기술 스택

| 영역 | 기술 |
|---|---|
| 프론트 | Next.js 16.2.4 (App Router) + React 19 + Tailwind v4 |
| UI | shadcn/ui + Radix |
| DB | Prisma v6 + NeonDB (Postgres serverless) |
| 인증 | NextAuth v5 beta (Google OAuth + Credentials) |
| LLM | Anthropic Claude (Haiku 4.5 / Sonnet 4.6) |
| 렌더링 | Remotion 4.0.448 (Player 브라우저 + Lambda 서버) |
| 결제 | Stripe (Checkout + Webhook) |
| 코드 평가 | sucrase + sandbox evaluator |

> 원본 PRD §7도 참고. 실제 구현은 PRD 작성 시점과 약간 다름 (Next 14→16, Prisma 7→6, middleware→proxy 등). REPORT.md "실제 구현 시 반영된 기술적 결정" 표 참고.

## 핵심 아키텍처 결정

[[../01-pm/decisions/0001-edit-not-equal-render|ADR-0001: 편집 ≠ 렌더]] — 가장 중요한 비용/UX 결정.

```
[편집 플로우]
유저 프롬프트 → /api/edit → Claude (코드만 수정) → 브라우저 Player ($0)

[Export 플로우]
유저 Export 클릭 → /api/export → Remotion Lambda → S3 → 다운로드
```

## 폴더 구조 (src/)

```
src/
├── app/
│   ├── (auth)/login/         # 로그인/회원가입
│   ├── (marketing)/          # 랜딩 + pricing
│   ├── studio/               # 메인 에디터 (3-panel)
│   ├── dashboard/            # 사용량 + 에셋 목록
│   └── api/                  # 9개 라우트
├── components/
│   ├── studio/               # PromptPanel, PlayerPanel, CustomizePanel, ExportPanel
│   └── gallery/              # TemplateCard, FilterBar
├── hooks/useStudio.ts        # zustand 기반 상태 관리
├── lib/
│   ├── ai/                   # generate, edit, prompts, extract-params
│   ├── remotion/             # sandbox, transpiler, evaluator
│   ├── db/                   # Prisma client
│   └── stripe/
└── remotion/
    ├── UniversalComposition.tsx
    └── templates/            # CounterAnimation, ComicEffect, BarChart
```

## API Routes

| Route | 역할 |
|---|---|
| `POST /api/generate` | 프롬프트 → Remotion 코드 생성 |
| `POST /api/edit` | Re-prompt 편집 (캐싱 적용) |
| `POST /api/export` | Lambda 렌더 트리거 |
| `GET /api/assets` | 내 에셋 목록 |
| `GET /api/usage` | 사용량 조회 |
| `/api/auth/[...nextauth]` | NextAuth |
| `POST /api/auth/register` | 이메일 가입 |
| `POST /api/stripe/checkout` | 구독 시작 |
| `POST /api/stripe/webhook` | 구독 상태 동기화 |

## Sandbox

`new Function` + sucrase로 클라이언트에서 동적 평가. 금지 패턴: `globalThis`, `__proto__`, `import.meta`, `indexedDB`. 자세히: `src/lib/remotion/sandbox.ts`.

## 관련

- [[../01-pm/decisions/0001-edit-not-equal-render|ADR-0001]]
- [[../01-pm/decisions/0002-customize-ui-auto-extract|ADR-0002]]
- [[../01-pm/decisions/0003-prompt-caching|ADR-0003]]
- Tech Notes:
    - [[tech-notes/nextjs-16-changes|Next.js 16 변경 영향]]
    - [[tech-notes/2026-04-26-evaluator-params-bug|Evaluator PARAMS 매칭 버그]]
    - [[tech-notes/2026-04-26-react-resizable-panels-v4-breaking|react-resizable-panels v4 breaking]]

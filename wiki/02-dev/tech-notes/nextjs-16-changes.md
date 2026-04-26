---
title: "Tech Note: Next.js 16 변경 영향"
created: 2026-04-18
updated: 2026-04-26
tags: [dev, tech/nextjs]
status: active
---

# Next.js 16 변경 영향

PRD에서 가정한 Next.js 14와 실제 설치된 16 사이의 차이로 발생한 변경점 기록.

## 주요 변경

| Before (계획) | After (실제) | 이유 |
|---|---|---|
| Next.js 14 | **16.2.4** | `npx create-next-app@latest` 기본값 |
| `experimental.serverComponentsExternalPackages` | **`serverExternalPackages`** | Next 16 리네임 |
| `middleware.ts` | **`proxy.ts`** | Next 16 deprecation |
| Tailwind v3 | **Tailwind v4** | create-next-app 기본값 |
| `theme()` in CSS | **raw hex 값** | Tailwind v4 미지원 |
| Prisma v7 (계획) | **v6** | v7에서 `directUrl` 제거됨 |
| `jest.config.ts` | **`jest.config.js`** | ts-node 미설치 |

## 주의사항

- `CLAUDE.md`(루트): "Read the relevant guide in `node_modules/next/dist/docs/` before writing any code"
- LLM이 **이전 Next.js 패턴을 자동완성하지 않도록** 시스템 프롬프트에 버전 명시
- middleware → proxy 전환 시 모든 `import { ... } from 'next/server'`의 함수 시그니처 재확인

## 관련

- 원본 보고서: `../../../docs/REPORT.md`
- 루트 `CLAUDE.md` / `AGENTS.md`

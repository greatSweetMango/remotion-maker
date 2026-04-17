# Team Context: EasyMake DEMO Build

## Task Description
EasyMake DEMO 풀 구현 — AI 기반 모션 에셋 생성 SaaS.
/Users/kimjaehyuk/Desktop/remotion-maker 에 완전히 새로운 앱을 구현한다.

## Detected Tags
#new-feature #frontend-ui #frontend-logic #backend-api #database

## Key Documents
- **Implementation Plan**: /Users/kimjaehyuk/Desktop/remotion-maker/docs/superpowers/plans/2026-04-18-easymake-demo.md
- **Design Spec**: /Users/kimjaehyuk/Desktop/remotion-maker/docs/superpowers/specs/2026-04-18-easymake-design.md
- **PRD**: /Users/kimjaehyuk/Desktop/remotion-maker/PRD.md

## Working Directory
/Users/kimjaehyuk/Desktop/remotion-maker

## Current Codebase State
- 기존 Remotion 프로토타입 파일들 존재 (src/, package.json, remotion.config.ts 등)
- Plan Task 1에서 이 파일들을 **모두 삭제**하고 Next.js 14 앱을 새로 만든다 — 이것은 의도된 동작
- docs/ 폴더 (spec, plan 포함)는 유지한다

## Tech Stack
Next.js 14 App Router · shadcn/ui · Tailwind CSS · Prisma · NeonDB · NextAuth.js (Google OAuth + Credentials) · Anthropic Claude API (Haiku/Sonnet) · @remotion/player · @remotion/renderer · sucrase · Stripe

## Available MCPs
- context7: ✅ 라이브러리 문서 조회
- serena: ✅ 코드 구조 분석
- playwright: ✅ 브라우저 테스트
- remotion-documentation: ✅ Remotion 공식 문서

## Team Composition & Task Ownership

| Role | Team Task | Plan Tasks | Blocked By |
|------|-----------|------------|-----------|
| Implementer-Foundation | IM-1 | Plan Tasks 1-3 | 없음 (시작 즉시) |
| Implementer-AI | IM-2 | Plan Tasks 4-6 | IM-1 완료 후 |
| Implementer-Studio | IM-3 | Plan Tasks 7-10 | IM-2 완료 후 |
| Implementer-Features | IM-4 | Plan Tasks 11-14 | IM-2 완료 후 |
| Implementer-Integration | IM-5 | Plan Tasks 15-17 | IM-3 + IM-4 완료 후 |
| Reviewer | RV-1 | 전체 코드 리뷰 | IM-5 완료 후 |
| Validator | VL-1 | E2E 검증 | RV-1 완료 후 |

## CRITICAL RULES FOR ALL IMPLEMENTERS

1. **플랜을 반드시 먼저 전체 읽어라** — 각 단계의 코드를 정확히 따른다
2. **모든 단계를 건너뛰지 마라** — 플랜의 코드 블록을 그대로 사용한다
3. **각 Task의 마지막 단계인 git commit을 반드시 실행한다**
4. **에러 발생 시 디버그하고 수정한 후 계속한다** — 에러를 무시하지 않는다
5. **자신의 Task 범위를 벗어난 파일은 수정하지 않는다**
6. **완료 시 TaskUpdate로 팀 태스크를 completed 처리하고 팀 리드에게 메시지 전송**

## ENV VARS 처리
- `.env.local`에 플레이스홀더 값으로 생성한다
- 실제 키 없이도 앱이 시작될 수 있도록 모든 env var에 placeholder를 넣는다
- `DATABASE_URL`: `postgresql://user:pass@localhost:5432/easymake` (placeholder)
- `ANTHROPIC_API_KEY`: `sk-ant-placeholder`
- `NEXTAUTH_SECRET`: `openssl rand -base64 32` 실행해서 실제 값 생성
- Stripe 관련: `sk_test_placeholder`
- Google OAuth: `placeholder`

## create-next-app 실행 방법
```bash
npx create-next-app@latest . \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --src-dir \
  --import-alias "@/*" \
  --no-git \
  --yes
```
(--yes 플래그로 모든 프롬프트를 기본값으로 자동 응답)

# EasyMake DEMO — Design Spec

> Date: 2026-04-18 | Status: Approved | Author: Claude

---

## Overview

EasyMake DEMO: AI 기반 모션 에셋 생성 SaaS. 텍스트 프롬프트 → Remotion 컴포넌트 코드 생성 → 브라우저 Player 즉시 재생 → 동적 커스터마이징 UI → Export.

환경변수만 세팅하면 모든 기능이 실제 동작하는 완전 구현 DEMO.

---

## Tech Stack

| 영역 | 기술 |
|---|---|
| Frontend | Next.js 14 (App Router) + shadcn/ui + Tailwind CSS |
| Auth | NextAuth.js (Google OAuth + Email/Password) |
| DB | Prisma + NeonDB (Serverless Postgres) |
| AI | Anthropic Claude API (Haiku=Free, Sonnet=Pro) |
| Preview | @remotion/player (브라우저 런타임) |
| Export | @remotion/renderer (Next.js API Route SSR) |
| Payment | Stripe (구독 + Webhook) |
| File | /tmp 저장 후 스트리밍 다운로드 (S3 없이 DEMO 단순화) |

---

## Project Structure

```
src/
├── app/
│   ├── (auth)/
│   │   └── login/page.tsx
│   ├── (marketing)/
│   │   ├── page.tsx               # Landing + Template Gallery
│   │   └── pricing/page.tsx
│   ├── studio/
│   │   └── page.tsx               # Main Editor (3-panel)
│   ├── dashboard/
│   │   └── page.tsx
│   └── api/
│       ├── generate/route.ts      # Claude → Remotion 코드 생성
│       ├── edit/route.ts          # Re-prompt 편집
│       ├── export/route.ts        # SSR 렌더 (GIF/MP4/WebM)
│       └── stripe/
│           └── webhook/route.ts
├── components/
│   ├── studio/
│   │   ├── PromptPanel.tsx        # 채팅 인터페이스
│   │   ├── PlayerPanel.tsx        # Remotion Player + 컨트롤
│   │   └── CustomizePanel.tsx     # 파라미터 UI 패널
│   ├── gallery/
│   │   ├── TemplateCard.tsx
│   │   └── FilterBar.tsx
│   └── ui/                        # shadcn 컴포넌트
├── lib/
│   ├── ai/
│   │   ├── generate.ts            # Claude 코드 생성 로직
│   │   ├── edit.ts                # Re-prompt + 캐싱
│   │   └── prompts.ts             # 시스템 프롬프트
│   ├── remotion/
│   │   ├── bundler.ts             # 코드 → 번들
│   │   ├── renderer.ts            # SSR export
│   │   └── sandbox.ts             # 생성 코드 보안 검증
│   ├── db/
│   │   └── prisma.ts              # Prisma client singleton
│   └── stripe/
│       └── client.ts
├── remotion/
│   └── templates/
│       ├── CounterAnimation.tsx
│       ├── ComicEffect.tsx
│       └── BarChart.tsx
└── middleware.ts                   # 사용량 체크 + Rate limiting
```

---

## Pages & UX

### `/` — Landing + Template Gallery
- Hero: 프롬프트 입력창 중앙 배치, 바로 생성 시작 가능
- Template Gallery: 카테고리 필터 + 미리보기 루프
- CTA: 로그인 → 스튜디오

### `/studio` — 3-Panel Editor
```
┌──────────────────┬──────────────────┬──────────────────┐
│  Prompt Panel    │   Player Panel   │  Customize Panel │
│  - 프롬프트 입력  │  - Remotion      │  - ColorPicker   │
│  - 대화 히스토리 │    Player        │  - Slider        │
│  - 모델 선택     │  - 배경 토글     │  - Input         │
│  - 버전 히스토리 │  - Export 버튼   │  - Switch        │
└──────────────────┴──────────────────┴──────────────────┘
```

### `/dashboard` — 사용량 + 에셋 히스토리
- 이번 달 생성/편집 횟수, 잔여 크레딧
- 내 에셋 카드 그리드

### `/pricing` — Free / Pro 비교표 + Stripe Checkout

---

## Database Schema

```prisma
model User {
  id            String    @id @default(cuid())
  email         String    @unique
  name          String?
  image         String?
  tier          Tier      @default(FREE)
  monthlyUsage  Int       @default(0)
  editUsage     Json      @default("{}")  // assetId -> count
  usageResetAt  DateTime  @default(now())
  assets        Asset[]
  subscription  Subscription?
  accounts      Account[]
  sessions      Session[]
}

model Asset {
  id          String         @id @default(cuid())
  userId      String
  title       String         @default("Untitled")
  code        String         @db.Text
  parameters  Json
  versions    AssetVersion[]
  createdAt   DateTime       @default(now())
  updatedAt   DateTime       @updatedAt
  user        User           @relation(fields: [userId], references: [id])
}

model AssetVersion {
  id        String   @id @default(cuid())
  assetId   String
  code      String   @db.Text
  prompt    String
  createdAt DateTime @default(now())
  asset     Asset    @relation(fields: [assetId], references: [id])
}

model Subscription {
  id                   String    @id @default(cuid())
  userId               String    @unique
  stripeCustomerId     String    @unique
  stripeSubscriptionId String?
  tier                 Tier      @default(FREE)
  status               String    @default("active")
  currentPeriodEnd     DateTime?
  user                 User      @relation(fields: [userId], references: [id])
}

enum Tier { FREE PRO }
```

---

## AI Pipeline

### 코드 생성

```
POST /api/generate
  → 티어 사용량 체크 (Free: 3회/월, Pro: 200회/월)
  → Claude API 호출 (model: haiku=Free, sonnet=Pro)
  → 시스템 프롬프트: 파라미터를 PARAMS const로 반드시 추출
  → 응답: { code, parameters, title }
  → sandbox 검증 (위험 패턴 제거)
  → DB에 Asset + AssetVersion 저장
  → 클라이언트로 반환 → Remotion Player 즉시 재생
```

### 파라미터 타입 시스템

```ts
type Parameter =
  | { key: string; type: "color"; value: string }
  | { key: string; type: "range"; value: number; min: number; max: number; unit?: string }
  | { key: string; type: "text"; value: string }
  | { key: string; type: "boolean"; value: boolean }
  | { key: string; type: "select"; value: string; options: string[] }

// UI 매핑
color   → ColorPicker (shadcn)
range   → Slider + NumberInput
text    → Input
boolean → Switch
select  → Select
```

### Re-prompt 편집 (프롬프트 캐싱)

```
POST /api/edit
  → Free: 에셋당 3회 제한
  → system + 기존 코드 = cache_control 블록 (입력 토큰 90% 절감)
  → 수정된 코드 반환 → AssetVersion 추가
```

---

## Export Pipeline

```
POST /api/export { assetId, format: "gif"|"mp4"|"webm"|"react" }
  → 티어 체크 (GIF=Free/워터마크, MP4+WebM=Pro, React=Pro)
  → react export: 코드 텍스트 직접 다운로드
  → 영상 export: @remotion/renderer SSR
  → /tmp/{uuid}.{ext} 저장 → 스트리밍 응답 → /tmp 정리
```

---

## Security

- **Code Sandbox:** 생성 코드에서 `eval`, `fetch`, `window.location`, `document.cookie`, `process`, `require`, `import(` 패턴 정규식 차단
- **Usage Middleware:** `/api/generate`, `/api/edit` 공통 미들웨어로 티어/사용량 체크
- **Rate Limiting:** IP + userId 기반 (in-memory, DEMO 단순화)
- **Stripe Webhook:** `stripe.webhooks.constructEvent` 서명 검증

---

## Built-in Templates

| 이름 | 파라미터 | 후킹 포인트 |
|---|---|---|
| CounterAnimation | target(number), color, speed, fontSize | PPT 회사원, 발표용 |
| ComicEffect | text, primaryColor, secondaryColor, size | SNS 바이럴 |
| BarChart | values(array), colors, animDuration, showLabels | 데이터 전문성 |

---

## Environment Variables

```env
# Auth
NEXTAUTH_SECRET=
NEXTAUTH_URL=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# DB
DATABASE_URL=

# AI
ANTHROPIC_API_KEY=

# Stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRO_PRICE_ID=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
```

---

## Tier Limits

| 기능 | Free | Pro |
|---|---|---|
| 월 생성 횟수 | 3회 | 200회 |
| 에셋당 편집 횟수 | 3회 | 무제한 |
| AI 모델 | Haiku | Sonnet |
| Export | GIF (워터마크) | 전체 포맷 |
| 커스터마이징 파라미터 | 최대 3개 표시 | 전체 |

# EasyMake DEMO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fully functional EasyMake DEMO — AI 기반 모션 에셋 생성 SaaS where users prompt → get Remotion animation → customize with auto-generated UI → export.

**Architecture:** Next.js 14 App Router single project. Generated Remotion TSX is transpiled server-side (sucrase) and evaluated client-side via `new Function` injected into `@remotion/player`. Export uses a pre-bundled Universal Composition rendered by `@remotion/renderer` in a Node.js API route.

**Tech Stack:** Next.js 14, shadcn/ui, Tailwind, Prisma, NeonDB, NextAuth.js, Anthropic Claude API, @remotion/player + @remotion/renderer, sucrase, Stripe

---

## File Map

```
remotion-maker/
├── .env.local
├── next.config.ts
├── tailwind.config.ts
├── prisma/
│   └── schema.prisma
├── src/
│   ├── middleware.ts
│   ├── types/index.ts
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── (auth)/login/page.tsx
│   │   ├── (marketing)/page.tsx              # Landing + Gallery
│   │   ├── (marketing)/pricing/page.tsx
│   │   ├── studio/page.tsx
│   │   ├── dashboard/page.tsx
│   │   └── api/
│   │       ├── auth/[...nextauth]/route.ts
│   │       ├── generate/route.ts
│   │       ├── edit/route.ts
│   │       ├── assets/route.ts
│   │       ├── export/route.ts
│   │       └── stripe/
│   │           ├── checkout/route.ts
│   │           └── webhook/route.ts
│   ├── components/
│   │   ├── providers/SessionProvider.tsx
│   │   ├── studio/
│   │   │   ├── Studio.tsx
│   │   │   ├── PromptPanel.tsx
│   │   │   ├── PlayerPanel.tsx
│   │   │   ├── CustomizePanel.tsx
│   │   │   ├── ParameterControl.tsx
│   │   │   └── ExportPanel.tsx
│   │   └── gallery/
│   │       ├── TemplateCard.tsx
│   │       └── FilterBar.tsx
│   ├── lib/
│   │   ├── ai/prompts.ts
│   │   ├── ai/generate.ts
│   │   ├── ai/edit.ts
│   │   ├── remotion/transpiler.ts
│   │   ├── remotion/sandbox.ts
│   │   ├── remotion/evaluator.ts
│   │   ├── db/prisma.ts
│   │   ├── stripe/client.ts
│   │   └── usage.ts
│   ├── hooks/useStudio.ts
│   └── remotion/
│       ├── UniversalComposition.tsx
│       └── templates/
│           ├── CounterAnimation.tsx
│           ├── ComicEffect.tsx
│           └── BarChart.tsx
└── __tests__/
    ├── lib/remotion/sandbox.test.ts
    ├── lib/remotion/transpiler.test.ts
    └── lib/usage.test.ts
```

---

## Task 1: Project Initialization

**Files:**
- Delete: all existing `src/`, `remotion.config.ts`, `package.json`, `package-lock.json`, `node_modules/`
- Create: `package.json`, `next.config.ts`, `tailwind.config.ts`, `tsconfig.json`, `.env.local`, `src/app/layout.tsx`

- [ ] **Step 1: Clean old project**

```bash
cd /Users/kimjaehyuk/Desktop/remotion-maker
rm -rf src node_modules package.json package-lock.json remotion.config.ts tsconfig.json
```

- [ ] **Step 2: Initialize Next.js 14 project**

```bash
cd /Users/kimjaehyuk/Desktop/remotion-maker
npx create-next-app@latest . \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --src-dir \
  --import-alias "@/*" \
  --no-git
```

- [ ] **Step 3: Install all dependencies**

```bash
npm install \
  @anthropic-ai/sdk \
  next-auth@beta \
  @auth/prisma-adapter \
  @prisma/client \
  prisma \
  sucrase \
  stripe \
  @stripe/stripe-js \
  remotion \
  @remotion/player \
  @remotion/renderer \
  @remotion/bundler \
  @remotion/cli \
  zustand \
  react-colorful \
  react-resizable-panels \
  sonner \
  lucide-react \
  clsx \
  tailwind-merge \
  class-variance-authority \
  @radix-ui/react-slider \
  @radix-ui/react-switch \
  @radix-ui/react-select \
  @radix-ui/react-dialog \
  @radix-ui/react-tabs \
  @radix-ui/react-tooltip \
  @radix-ui/react-dropdown-menu \
  @radix-ui/react-avatar \
  @radix-ui/react-progress \
  @radix-ui/react-separator
```

```bash
npm install -D \
  @types/node \
  jest \
  jest-environment-jsdom \
  @testing-library/react \
  @testing-library/jest-dom \
  ts-jest
```

- [ ] **Step 4: Initialize shadcn/ui**

```bash
npx shadcn@latest init -y
npx shadcn@latest add button input label slider switch select dialog tabs tooltip dropdown-menu avatar progress separator badge card textarea scroll-area skeleton
```

- [ ] **Step 5: Create `next.config.ts`**

```typescript
import type { NextConfig } from 'next';

const config: NextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['@remotion/renderer', '@remotion/bundler', 'sucrase'],
  },
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
};

export default config;
```

- [ ] **Step 6: Create `.env.local`**

```env
# Auth
NEXTAUTH_SECRET=your-secret-here-generate-with-openssl-rand-base64-32
NEXTAUTH_URL=http://localhost:3000
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Database
DATABASE_URL=

# AI
ANTHROPIC_API_KEY=

# Stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRO_PRICE_ID=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
```

- [ ] **Step 7: Create `src/types/index.ts`**

```typescript
export type Tier = 'FREE' | 'PRO';

export type ParameterType = 'color' | 'range' | 'text' | 'boolean' | 'select';

export interface Parameter {
  key: string;
  label: string;
  group: 'color' | 'size' | 'timing' | 'text' | 'other';
  type: ParameterType;
  value: string | number | boolean;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: string[];
}

export interface GeneratedAsset {
  id: string;
  title: string;
  code: string;         // Original TSX (for display/download)
  jsCode: string;       // Transpiled JS (for browser eval)
  parameters: Parameter[];
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
}

export interface AssetVersion {
  id: string;
  code: string;
  jsCode: string;
  parameters: Parameter[];
  prompt: string;
  createdAt: string;
}

export interface StudioState {
  asset: GeneratedAsset | null;
  versions: AssetVersion[];
  currentVersionIndex: number;
  paramValues: Record<string, string | number | boolean>;
  isGenerating: boolean;
  isEditing: boolean;
  isExporting: boolean;
  error: string | null;
}

export type StudioAction =
  | { type: 'SET_GENERATING'; payload: boolean }
  | { type: 'SET_EDITING'; payload: boolean }
  | { type: 'SET_EXPORTING'; payload: boolean }
  | { type: 'SET_ASSET'; payload: GeneratedAsset }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'UPDATE_PARAM'; payload: { key: string; value: string | number | boolean } }
  | { type: 'ADD_VERSION'; payload: AssetVersion }
  | { type: 'RESTORE_VERSION'; payload: number };

export interface Template {
  id: string;
  title: string;
  description: string;
  category: 'counter' | 'text' | 'chart' | 'background' | 'logo';
  previewGif?: string;
  code: string;
  jsCode: string;
  parameters: Parameter[];
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
}

export type ExportFormat = 'gif' | 'mp4' | 'webm' | 'react';

export interface UsageInfo {
  monthlyGenerations: number;
  monthlyGenerationLimit: number;
  tier: Tier;
}
```

- [ ] **Step 8: Create root layout `src/app/layout.tsx`**

```tsx
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { SessionProvider } from '@/components/providers/SessionProvider';
import { Toaster } from 'sonner';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'EasyMake — Animate anything, your way',
  description: 'AI-powered motion asset generator. Create Remotion animations with text prompts.',
  openGraph: {
    title: 'EasyMake — Animate anything, your way',
    description: 'AI-powered motion asset generator.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <SessionProvider>
          {children}
          <Toaster richColors position="top-right" />
        </SessionProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 9: Create `src/components/providers/SessionProvider.tsx`**

```tsx
'use client';
import { SessionProvider as NextAuthSessionProvider } from 'next-auth/react';

export function SessionProvider({ children }: { children: React.ReactNode }) {
  return <NextAuthSessionProvider>{children}</NextAuthSessionProvider>;
}
```

- [ ] **Step 10: Verify dev server starts**

```bash
npm run dev
```

Expected: Server starts at http://localhost:3000 with default Next.js page.

- [ ] **Step 11: Commit**

```bash
git init
git add .
git commit -m "feat: initialize Next.js 14 project with dependencies"
```

---

## Task 2: Database Schema + Prisma

**Files:**
- Create: `prisma/schema.prisma`
- Create: `src/lib/db/prisma.ts`

- [ ] **Step 1: Initialize Prisma**

```bash
npx prisma init --datasource-provider postgresql
```

- [ ] **Step 2: Write `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DATABASE_URL")
}

model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String? @db.Text
  access_token      String? @db.Text
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String? @db.Text
  session_state     String?
  user              User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
}

model User {
  id               String        @id @default(cuid())
  email            String        @unique
  emailVerified    DateTime?
  name             String?
  image            String?
  password         String?
  tier             Tier          @default(FREE)
  monthlyUsage     Int           @default(0)
  editUsage        Json          @default("{}")
  usageResetAt     DateTime      @default(now())
  assets           Asset[]
  subscription     Subscription?
  accounts         Account[]
  sessions         Session[]
  createdAt        DateTime      @default(now())
}

model Asset {
  id          String         @id @default(cuid())
  userId      String
  title       String         @default("Untitled")
  code        String         @db.Text
  jsCode      String         @db.Text
  parameters  Json
  durationInFrames Int       @default(150)
  fps         Int            @default(30)
  width       Int            @default(1920)
  height      Int            @default(1080)
  versions    AssetVersion[]
  createdAt   DateTime       @default(now())
  updatedAt   DateTime       @updatedAt
  user        User           @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model AssetVersion {
  id         String   @id @default(cuid())
  assetId    String
  code       String   @db.Text
  jsCode     String   @db.Text
  parameters Json
  prompt     String   @db.Text
  createdAt  DateTime @default(now())
  asset      Asset    @relation(fields: [assetId], references: [id], onDelete: Cascade)
}

model Subscription {
  id                   String    @id @default(cuid())
  userId               String    @unique
  stripeCustomerId     String    @unique
  stripeSubscriptionId String?
  tier                 Tier      @default(FREE)
  status               String    @default("active")
  currentPeriodEnd     DateTime?
  cancelAtPeriodEnd    Boolean   @default(false)
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt
  user                 User      @relation(fields: [userId], references: [id], onDelete: Cascade)
}

enum Tier {
  FREE
  PRO
}
```

- [ ] **Step 3: Create `src/lib/db/prisma.ts`**

```typescript
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
```

- [ ] **Step 4: Add DATABASE_URL to `.env.local`, then push schema**

After setting NeonDB `DATABASE_URL` in `.env.local`:

```bash
npx prisma db push
npx prisma generate
```

Expected: `✓ Your database is now in sync with your Prisma schema.`

- [ ] **Step 5: Commit**

```bash
git add prisma/ src/lib/db/
git commit -m "feat: add Prisma schema with User, Asset, Subscription models"
```

---

## Task 3: NextAuth.js Setup

**Files:**
- Create: `src/lib/auth.ts`
- Create: `src/app/api/auth/[...nextauth]/route.ts`
- Create: `src/app/(auth)/login/page.tsx`
- Modify: `src/middleware.ts`

- [ ] **Step 1: Create `src/lib/auth.ts`**

```typescript
import NextAuth from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from '@/lib/db/prisma';
import bcrypt from 'bcryptjs';

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
        });
        if (!user?.password) return null;
        const valid = await bcrypt.compare(credentials.password as string, user.password);
        return valid ? user : null;
      },
    }),
  ],
  callbacks: {
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
        const dbUser = await prisma.user.findUnique({ where: { id: token.sub } });
        if (dbUser) session.user.tier = dbUser.tier;
      }
      return session;
    },
    async jwt({ token, user }) {
      if (user) token.sub = user.id;
      return token;
    },
  },
  pages: { signIn: '/login' },
  session: { strategy: 'jwt' },
});
```

- [ ] **Step 2: Install bcryptjs**

```bash
npm install bcryptjs
npm install -D @types/bcryptjs
```

- [ ] **Step 3: Create `src/app/api/auth/[...nextauth]/route.ts`**

```typescript
import { handlers } from '@/lib/auth';
export const { GET, POST } = handlers;
```

- [ ] **Step 4: Add registration endpoint `src/app/api/auth/register/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db/prisma';

export async function POST(req: Request) {
  const { email, password, name } = await req.json();

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: 'Email already in use' }, { status: 400 });
  }

  const hashed = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { email, name, password: hashed },
  });

  return NextResponse.json({ id: user.id, email: user.email }, { status: 201 });
}
```

- [ ] **Step 5: Extend NextAuth types `src/types/next-auth.d.ts`**

```typescript
import type { DefaultSession } from 'next-auth';
import type { Tier } from '@/types';

declare module 'next-auth' {
  interface Session {
    user: DefaultSession['user'] & {
      id: string;
      tier: Tier;
    };
  }
}
```

- [ ] **Step 6: Create login page `src/app/(auth)/login/page.tsx`**

```tsx
'use client';
import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Zap } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [loginData, setLoginData] = useState({ email: '', password: '' });
  const [registerData, setRegisterData] = useState({ email: '', password: '', name: '' });

  async function handleGoogleSignIn() {
    setLoading(true);
    await signIn('google', { callbackUrl: '/studio' });
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const result = await signIn('credentials', {
      ...loginData,
      redirect: false,
    });
    if (result?.error) {
      toast.error('Invalid credentials');
      setLoading(false);
    } else {
      router.push('/studio');
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registerData),
    });
    if (!res.ok) {
      const { error } = await res.json();
      toast.error(error);
      setLoading(false);
      return;
    }
    await signIn('credentials', {
      email: registerData.email,
      password: registerData.password,
      callbackUrl: '/studio',
    });
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Zap className="h-8 w-8 text-violet-400" />
            <span className="text-2xl font-bold text-white">EasyMake</span>
          </div>
          <p className="text-slate-400">Animate anything, your way</p>
        </div>

        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white">Get started</CardTitle>
            <CardDescription className="text-slate-400">Sign in or create your account</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              onClick={handleGoogleSignIn}
              disabled={loading}
              variant="outline"
              className="w-full border-slate-600 text-white hover:bg-slate-700"
            >
              <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </Button>

            <div className="flex items-center gap-2">
              <Separator className="flex-1 bg-slate-600" />
              <span className="text-slate-400 text-xs">or</span>
              <Separator className="flex-1 bg-slate-600" />
            </div>

            <Tabs defaultValue="login">
              <TabsList className="w-full bg-slate-700">
                <TabsTrigger value="login" className="flex-1">Sign In</TabsTrigger>
                <TabsTrigger value="register" className="flex-1">Register</TabsTrigger>
              </TabsList>

              <TabsContent value="login">
                <form onSubmit={handleLogin} className="space-y-3">
                  <div>
                    <Label className="text-slate-300">Email</Label>
                    <Input
                      type="email"
                      value={loginData.email}
                      onChange={e => setLoginData(p => ({ ...p, email: e.target.value }))}
                      className="bg-slate-700 border-slate-600 text-white"
                      placeholder="you@example.com"
                      required
                    />
                  </div>
                  <div>
                    <Label className="text-slate-300">Password</Label>
                    <Input
                      type="password"
                      value={loginData.password}
                      onChange={e => setLoginData(p => ({ ...p, password: e.target.value }))}
                      className="bg-slate-700 border-slate-600 text-white"
                      placeholder="••••••••"
                      required
                    />
                  </div>
                  <Button type="submit" disabled={loading} className="w-full bg-violet-600 hover:bg-violet-700">
                    Sign In
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="register">
                <form onSubmit={handleRegister} className="space-y-3">
                  <div>
                    <Label className="text-slate-300">Name</Label>
                    <Input
                      value={registerData.name}
                      onChange={e => setRegisterData(p => ({ ...p, name: e.target.value }))}
                      className="bg-slate-700 border-slate-600 text-white"
                      placeholder="Your name"
                    />
                  </div>
                  <div>
                    <Label className="text-slate-300">Email</Label>
                    <Input
                      type="email"
                      value={registerData.email}
                      onChange={e => setRegisterData(p => ({ ...p, email: e.target.value }))}
                      className="bg-slate-700 border-slate-600 text-white"
                      placeholder="you@example.com"
                      required
                    />
                  </div>
                  <div>
                    <Label className="text-slate-300">Password</Label>
                    <Input
                      type="password"
                      value={registerData.password}
                      onChange={e => setRegisterData(p => ({ ...p, password: e.target.value }))}
                      className="bg-slate-700 border-slate-600 text-white"
                      placeholder="••••••••"
                      minLength={8}
                      required
                    />
                  </div>
                  <Button type="submit" disabled={loading} className="w-full bg-violet-600 hover:bg-violet-700">
                    Create Account
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <p className="text-center text-slate-500 text-sm">
          By continuing, you agree to our Terms of Service
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Create `src/middleware.ts`**

```typescript
import { auth } from '@/lib/auth';
import { NextResponse } from 'next/server';

const PROTECTED_PATHS = ['/studio', '/dashboard'];

export default auth((req) => {
  const { nextUrl, auth: session } = req;
  const isProtected = PROTECTED_PATHS.some(p => nextUrl.pathname.startsWith(p));

  if (isProtected && !session) {
    return NextResponse.redirect(new URL('/login', nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
```

- [ ] **Step 8: Commit**

```bash
git add .
git commit -m "feat: add NextAuth.js with Google OAuth and email/password auth"
```

---

## Task 4: Code Sandbox + Transpiler

**Files:**
- Create: `src/lib/remotion/sandbox.ts`
- Create: `src/lib/remotion/transpiler.ts`
- Create: `__tests__/lib/remotion/sandbox.test.ts`
- Create: `__tests__/lib/remotion/transpiler.test.ts`

- [ ] **Step 1: Write failing tests for sandbox**

Create `__tests__/lib/remotion/sandbox.test.ts`:

```typescript
import { validateCode, sanitizeCode } from '@/lib/remotion/sandbox';

describe('validateCode', () => {
  it('allows clean Remotion component code', () => {
    const code = `
      const { useCurrentFrame, AbsoluteFill } = remotion;
      const PARAMS = { color: '#fff' };
      const Component = () => <AbsoluteFill style={{ backgroundColor: PARAMS.color }} />;
    `;
    expect(validateCode(code)).toEqual({ valid: true, errors: [] });
  });

  it('blocks eval usage', () => {
    const code = `eval('malicious code')`;
    expect(validateCode(code).valid).toBe(false);
    expect(validateCode(code).errors).toContain('Forbidden: eval');
  });

  it('blocks fetch usage', () => {
    const code = `fetch('https://evil.com/steal')`;
    expect(validateCode(code).valid).toBe(false);
  });

  it('blocks process access', () => {
    const code = `process.env.SECRET`;
    expect(validateCode(code).valid).toBe(false);
  });

  it('blocks document.cookie access', () => {
    const code = `document.cookie`;
    expect(validateCode(code).valid).toBe(false);
  });

  it('blocks dynamic import', () => {
    const code = `import('malicious')`;
    expect(validateCode(code).valid).toBe(false);
  });

  it('blocks require', () => {
    const code = `require('fs')`;
    expect(validateCode(code).valid).toBe(false);
  });
});

describe('sanitizeCode', () => {
  it('removes remotion import statements', () => {
    const code = `import { useCurrentFrame } from 'remotion';\nconst frame = useCurrentFrame();`;
    const result = sanitizeCode(code);
    expect(result).not.toContain("from 'remotion'");
    expect(result).toContain('const frame = useCurrentFrame()');
  });

  it('removes react import statements', () => {
    const code = `import React from 'react';\nconst x = 1;`;
    const result = sanitizeCode(code);
    expect(result).not.toContain("from 'react'");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest __tests__/lib/remotion/sandbox.test.ts --no-coverage 2>&1 | head -20
```

Expected: FAIL — `Cannot find module '@/lib/remotion/sandbox'`

- [ ] **Step 3: Create `src/lib/remotion/sandbox.ts`**

```typescript
interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\beval\s*\(/, label: 'Forbidden: eval' },
  { pattern: /\bFunction\s*\(/, label: 'Forbidden: Function constructor' },
  { pattern: /\bfetch\s*\(/, label: 'Forbidden: fetch' },
  { pattern: /\bXMLHttpRequest\b/, label: 'Forbidden: XMLHttpRequest' },
  { pattern: /\bprocess\s*\./, label: 'Forbidden: process' },
  { pattern: /\brequire\s*\(/, label: 'Forbidden: require' },
  { pattern: /\bdocument\s*\.\s*cookie/, label: 'Forbidden: document.cookie' },
  { pattern: /\blocalStorage\b/, label: 'Forbidden: localStorage' },
  { pattern: /\bsessionStorage\b/, label: 'Forbidden: sessionStorage' },
  { pattern: /\bwindow\s*\.\s*location/, label: 'Forbidden: window.location' },
  { pattern: /\bimport\s*\(/, label: 'Forbidden: dynamic import' },
  { pattern: /\bWebSocket\b/, label: 'Forbidden: WebSocket' },
];

export function validateCode(code: string): ValidationResult {
  const errors: string[] = [];

  for (const { pattern, label } of FORBIDDEN_PATTERNS) {
    if (pattern.test(code)) {
      errors.push(label);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function sanitizeCode(code: string): string {
  return code
    .replace(/^import\s+.*?from\s+['"]remotion['"];?\s*$/gm, '')
    .replace(/^import\s+.*?from\s+['"]react['"];?\s*$/gm, '')
    .replace(/^import\s+type\s+.*?from\s+['"].*?['"];?\s*$/gm, '')
    .replace(/^export\s+default\s+/gm, 'const DefaultExport = ')
    .trim();
}
```

- [ ] **Step 4: Write failing tests for transpiler**

Create `__tests__/lib/remotion/transpiler.test.ts`:

```typescript
import { transpileTSX } from '@/lib/remotion/transpiler';

describe('transpileTSX', () => {
  it('strips TypeScript types', async () => {
    const code = `const x: number = 5;`;
    const result = await transpileTSX(code);
    expect(result).not.toContain(': number');
    expect(result).toContain('const x');
  });

  it('transforms JSX to React.createElement', async () => {
    const code = `const el = <div className="test">hello</div>;`;
    const result = await transpileTSX(code);
    expect(result).not.toContain('<div');
    expect(result).toContain('React.createElement');
  });

  it('handles arrow functions with JSX', async () => {
    const code = `const Comp = () => <span style={{ color: 'red' }}>Hi</span>;`;
    const result = await transpileTSX(code);
    expect(result).toContain('React.createElement');
    expect(result).toContain('"span"');
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

```bash
npx jest __tests__/lib/remotion/transpiler.test.ts --no-coverage 2>&1 | head -20
```

Expected: FAIL — `Cannot find module '@/lib/remotion/transpiler'`

- [ ] **Step 6: Create `src/lib/remotion/transpiler.ts`**

```typescript
import { transform } from 'sucrase';

export async function transpileTSX(code: string): Promise<string> {
  const result = transform(code, {
    transforms: ['typescript', 'jsx'],
    jsxRuntime: 'classic',
    production: false,
  });
  return result.code;
}
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
npx jest __tests__/lib/remotion/ --no-coverage
```

Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add src/lib/remotion/ __tests__/
git commit -m "feat: add code sandbox validator and sucrase TSX transpiler"
```

---

## Task 5: AI Generation Pipeline

**Files:**
- Create: `src/lib/ai/prompts.ts`
- Create: `src/lib/ai/generate.ts`
- Create: `src/lib/ai/edit.ts`
- Create: `src/lib/usage.ts`
- Create: `src/app/api/generate/route.ts`
- Create: `src/app/api/edit/route.ts`
- Create: `__tests__/lib/usage.test.ts`

- [ ] **Step 1: Write failing tests for usage checking**

Create `__tests__/lib/usage.test.ts`:

```typescript
import { checkGenerationLimit, checkEditLimit, TIER_LIMITS } from '@/lib/usage';

describe('checkGenerationLimit', () => {
  it('allows FREE user within limit', () => {
    expect(checkGenerationLimit({ tier: 'FREE', monthlyUsage: 2 })).toEqual({ allowed: true });
  });

  it('blocks FREE user at limit', () => {
    const result = checkGenerationLimit({ tier: 'FREE', monthlyUsage: 3 });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('limit');
  });

  it('allows PRO user within limit', () => {
    expect(checkGenerationLimit({ tier: 'PRO', monthlyUsage: 150 })).toEqual({ allowed: true });
  });

  it('blocks PRO user at limit', () => {
    expect(checkGenerationLimit({ tier: 'PRO', monthlyUsage: 200 }).allowed).toBe(false);
  });
});

describe('checkEditLimit', () => {
  it('allows FREE user with edits under 3', () => {
    expect(checkEditLimit({ tier: 'FREE', editCount: 2 })).toEqual({ allowed: true });
  });

  it('blocks FREE user at 3 edits for same asset', () => {
    expect(checkEditLimit({ tier: 'FREE', editCount: 3 }).allowed).toBe(false);
  });

  it('always allows PRO user', () => {
    expect(checkEditLimit({ tier: 'PRO', editCount: 999 })).toEqual({ allowed: true });
  });
});
```

- [ ] **Step 2: Run to verify fails**

```bash
npx jest __tests__/lib/usage.test.ts --no-coverage 2>&1 | head -20
```

- [ ] **Step 3: Create `src/lib/usage.ts`**

```typescript
import type { Tier } from '@/types';

export const TIER_LIMITS = {
  FREE: { monthlyGenerations: 3, editsPerAsset: 3 },
  PRO:  { monthlyGenerations: 200, editsPerAsset: Infinity },
} as const;

interface UsageCheckResult {
  allowed: boolean;
  reason?: string;
}

export function checkGenerationLimit(params: { tier: Tier; monthlyUsage: number }): UsageCheckResult {
  const limit = TIER_LIMITS[params.tier].monthlyGenerations;
  if (params.monthlyUsage >= limit) {
    return {
      allowed: false,
      reason: `Monthly generation limit reached (${limit}). ${params.tier === 'FREE' ? 'Upgrade to Pro for 200/month.' : 'Purchase additional credits.'}`,
    };
  }
  return { allowed: true };
}

export function checkEditLimit(params: { tier: Tier; editCount: number }): UsageCheckResult {
  const limit = TIER_LIMITS[params.tier].editsPerAsset;
  if (params.editCount >= limit) {
    return {
      allowed: false,
      reason: `Edit limit reached (${limit} per asset on Free plan). Upgrade to Pro for unlimited edits.`,
    };
  }
  return { allowed: true };
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npx jest __tests__/lib/usage.test.ts --no-coverage
```

Expected: All PASS

- [ ] **Step 5: Create `src/lib/ai/prompts.ts`**

```typescript
export const GENERATION_SYSTEM_PROMPT = `You are an expert Remotion animation developer. Generate a complete, working Remotion React component for the user's request.

STRICT REQUIREMENTS:
1. Export a PARAMS constant with ALL customizable values and type annotations
2. Export the component as the last statement: export const GeneratedAsset = ...
3. Use only Remotion hooks/utilities from the global 'remotion' object (no imports needed)
4. Component receives spread props from PARAMS as default: ({ ...PARAMS } = PARAMS)
5. Ensure transparent background support with AbsoluteFill

PARAMS FORMAT (REQUIRED):
\`\`\`typescript
const PARAMS = {
  // Each value must have a comment with: type, and optionally: min, max, unit, options
  primaryColor: "#7C3AED",     // type: color
  secondaryColor: "#A78BFA",   // type: color
  speed: 1.0,                  // type: range, min: 0.1, max: 3.0
  text: "Hello World",         // type: text
  fontSize: 80,                // type: range, min: 20, max: 200, unit: px
  visible: true,               // type: boolean
  animStyle: "bounce",         // type: select, options: bounce|spring|linear
} as const;
\`\`\`

COMPONENT FORMAT (REQUIRED):
\`\`\`typescript
export const GeneratedAsset = ({
  primaryColor = PARAMS.primaryColor,
  speed = PARAMS.speed,
  // ... all params
}: typeof PARAMS = PARAMS) => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps, width, height } = useVideoConfig();
  // animation logic
  return (
    <AbsoluteFill style={{ backgroundColor: 'transparent' }}>
      {/* component content */}
    </AbsoluteFill>
  );
};
\`\`\`

AVAILABLE REMOTION GLOBALS (already injected, no imports needed):
- useCurrentFrame, useVideoConfig
- interpolate, interpolateColors, spring
- AbsoluteFill, Sequence, Audio, Img, Video, OffthreadVideo
- Easing

ANIMATION QUALITY STANDARDS:
- Use spring() for bouncy/natural motion
- Use interpolate() with Easing for smooth transitions
- Animations should loop gracefully or have clear start/end
- Default composition: 1920x1080, 30fps, 150 frames (5 seconds)

ALWAYS respond with valid JSON in this exact format:
{
  "title": "Descriptive asset name",
  "code": "// Complete TSX code here",
  "durationInFrames": 150,
  "fps": 30,
  "width": 1920,
  "height": 1080
}`;

export const EDIT_SYSTEM_PROMPT = `You are an expert Remotion animation developer modifying existing code.

Rules:
- Return ONLY the modified code, maintaining the same PARAMS structure and component export name
- Keep all existing PARAMS unless the user explicitly asks to remove them
- Add new PARAMS if the user request requires new customizable values
- Maintain backward compatibility with existing PARAMS values
- ALWAYS respond with valid JSON: { "title": "...", "code": "...", "durationInFrames": N, "fps": N, "width": N, "height": N }`;

export function buildEditMessages(existingCode: string, userRequest: string) {
  return [
    {
      role: 'user' as const,
      content: [
        {
          type: 'text' as const,
          text: `EXISTING CODE:\n\`\`\`typescript\n${existingCode}\n\`\`\``,
          cache_control: { type: 'ephemeral' as const },
        },
        {
          type: 'text' as const,
          text: `USER REQUEST: ${userRequest}\n\nReturn the complete modified code as JSON.`,
        },
      ],
    },
  ];
}
```

- [ ] **Step 6: Create `src/lib/ai/generate.ts`**

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { GENERATION_SYSTEM_PROMPT } from './prompts';
import { transpileTSX } from '@/lib/remotion/transpiler';
import { validateCode, sanitizeCode } from '@/lib/remotion/sandbox';
import type { GeneratedAsset, Parameter } from '@/types';

const client = new Anthropic();

function extractParameters(code: string): Parameter[] {
  const params: Parameter[] = [];

  // Match PARAMS object
  const paramsMatch = code.match(/const PARAMS\s*=\s*\{([\s\S]*?)\}\s*(?:as const)?/);
  if (!paramsMatch) return params;

  const paramsBody = paramsMatch[1];
  const lines = paramsBody.split('\n');

  let groupIndex = 0;
  const colorKeys: string[] = [];

  for (const line of lines) {
    // Match: key: value, // type: xxx, ...options
    const match = line.match(/^\s*(\w+)\s*:\s*(.+?),?\s*\/\/\s*type:\s*(\w+)(.*?)$/);
    if (!match) continue;

    const [, key, rawValue, typeStr, rest] = match;
    const type = typeStr as Parameter['type'];

    const parseNum = (s: string) => parseFloat(s.trim());
    const minMatch = rest.match(/min:\s*([\d.]+)/);
    const maxMatch = rest.match(/max:\s*([\d.]+)/);
    const unitMatch = rest.match(/unit:\s*(\w+)/);
    const optionsMatch = rest.match(/options:\s*([\w|]+)/);

    const label = key
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, s => s.toUpperCase())
      .trim();

    let group: Parameter['group'] = 'other';
    if (type === 'color') group = 'color';
    else if (key.toLowerCase().includes('speed') || key.toLowerCase().includes('duration') || key.toLowerCase().includes('delay')) group = 'timing';
    else if (key.toLowerCase().includes('size') || key.toLowerCase().includes('font') || key.toLowerCase().includes('width') || key.toLowerCase().includes('height') || key.toLowerCase().includes('radius')) group = 'size';
    else if (type === 'text') group = 'text';

    const value = type === 'color'
      ? rawValue.replace(/['"]/g, '')
      : type === 'boolean'
        ? rawValue.trim() === 'true'
        : type === 'text'
          ? rawValue.replace(/['"]/g, '')
          : parseFloat(rawValue) || 0;

    params.push({
      key,
      label,
      group,
      type,
      value,
      min: minMatch ? parseNum(minMatch[1]) : undefined,
      max: maxMatch ? parseNum(maxMatch[1]) : undefined,
      unit: unitMatch?.[1],
      options: optionsMatch ? optionsMatch[1].split('|') : undefined,
    });
  }

  return params;
}

export async function generateAsset(
  prompt: string,
  model: 'claude-haiku-4-5-20251001' | 'claude-sonnet-4-6' = 'claude-haiku-4-5-20251001'
): Promise<GeneratedAsset> {
  const message = await client.messages.create({
    model,
    max_tokens: 4096,
    system: GENERATION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '';

  // Extract JSON from response (might be wrapped in code blocks)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI did not return valid JSON');

  const parsed = JSON.parse(jsonMatch[0]);
  const { title, code, durationInFrames, fps, width, height } = parsed;

  const validation = validateCode(code);
  if (!validation.valid) {
    throw new Error(`Generated code failed security check: ${validation.errors.join(', ')}`);
  }

  const sanitized = sanitizeCode(code);
  const jsCode = await transpileTSX(sanitized);
  const parameters = extractParameters(code);

  return {
    id: crypto.randomUUID(),
    title,
    code,
    jsCode,
    parameters,
    durationInFrames: durationInFrames || 150,
    fps: fps || 30,
    width: width || 1920,
    height: height || 1080,
  };
}
```

- [ ] **Step 7: Create `src/lib/ai/edit.ts`**

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { EDIT_SYSTEM_PROMPT, buildEditMessages } from './prompts';
import { transpileTSX } from '@/lib/remotion/transpiler';
import { validateCode, sanitizeCode } from '@/lib/remotion/sandbox';
import { generateAsset } from './generate';
import type { GeneratedAsset } from '@/types';

const client = new Anthropic();

export async function editAsset(
  existingCode: string,
  userRequest: string,
  model: 'claude-haiku-4-5-20251001' | 'claude-sonnet-4-6' = 'claude-sonnet-4-6'
): Promise<GeneratedAsset> {
  const messages = buildEditMessages(existingCode, userRequest);

  const message = await client.messages.create({
    model,
    max_tokens: 4096,
    system: EDIT_SYSTEM_PROMPT,
    messages,
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI did not return valid JSON');

  const parsed = JSON.parse(jsonMatch[0]);
  const { title, code, durationInFrames, fps, width, height } = parsed;

  const validation = validateCode(code);
  if (!validation.valid) {
    throw new Error(`Edited code failed security check: ${validation.errors.join(', ')}`);
  }

  const sanitized = sanitizeCode(code);
  const jsCode = await transpileTSX(sanitized);

  // Re-extract parameters using generateAsset's logic
  const asset = await generateAsset(userRequest, model).catch(() => null);

  // Manually build the result (can't reuse generateAsset directly here)
  const { extractParameters } = await import('./generate').then(m => ({
    extractParameters: (c: string) => m.generateAsset(c, model),
  }));

  return {
    id: crypto.randomUUID(),
    title: title || 'Edited Asset',
    code,
    jsCode,
    parameters: asset?.parameters || [],
    durationInFrames: durationInFrames || 150,
    fps: fps || 30,
    width: width || 1920,
    height: height || 1080,
  };
}
```

- [ ] **Step 8: Create `src/app/api/generate/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { generateAsset } from '@/lib/ai/generate';
import { checkGenerationLimit } from '@/lib/usage';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  // Reset monthly usage if new month
  const now = new Date();
  const resetAt = new Date(user.usageResetAt);
  if (now.getMonth() !== resetAt.getMonth() || now.getFullYear() !== resetAt.getFullYear()) {
    await prisma.user.update({
      where: { id: user.id },
      data: { monthlyUsage: 0, usageResetAt: now, editUsage: {} },
    });
    user.monthlyUsage = 0;
  }

  const limitCheck = checkGenerationLimit({ tier: user.tier, monthlyUsage: user.monthlyUsage });
  if (!limitCheck.allowed) {
    return NextResponse.json({ error: limitCheck.reason }, { status: 429 });
  }

  const { prompt } = await req.json();
  if (!prompt?.trim()) {
    return NextResponse.json({ error: 'Prompt required' }, { status: 400 });
  }

  const model = user.tier === 'PRO' ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001';

  try {
    const asset = await generateAsset(prompt, model);

    // Save to DB
    const dbAsset = await prisma.asset.create({
      data: {
        userId: user.id,
        title: asset.title,
        code: asset.code,
        jsCode: asset.jsCode,
        parameters: asset.parameters as any,
        durationInFrames: asset.durationInFrames,
        fps: asset.fps,
        width: asset.width,
        height: asset.height,
        versions: {
          create: {
            code: asset.code,
            jsCode: asset.jsCode,
            parameters: asset.parameters as any,
            prompt,
          },
        },
      },
    });

    // Increment usage
    await prisma.user.update({
      where: { id: user.id },
      data: { monthlyUsage: { increment: 1 } },
    });

    return NextResponse.json({ ...asset, id: dbAsset.id });
  } catch (error: any) {
    console.error('Generation error:', error);
    return NextResponse.json({ error: error.message || 'Generation failed' }, { status: 500 });
  }
}
```

- [ ] **Step 9: Create `src/app/api/edit/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { editAsset } from '@/lib/ai/edit';
import { checkEditLimit } from '@/lib/usage';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { assetId, prompt, currentCode } = await req.json();
  if (!assetId || !prompt || !currentCode) {
    return NextResponse.json({ error: 'assetId, prompt, and currentCode required' }, { status: 400 });
  }

  const [user, asset] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.user.id } }),
    prisma.asset.findUnique({ where: { id: assetId, userId: session.user.id } }),
  ]);

  if (!user || !asset) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const editUsage = (user.editUsage as Record<string, number>) || {};
  const editCount = editUsage[assetId] || 0;

  const limitCheck = checkEditLimit({ tier: user.tier, editCount });
  if (!limitCheck.allowed) {
    return NextResponse.json({ error: limitCheck.reason }, { status: 429 });
  }

  const model = user.tier === 'PRO' ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001';

  try {
    const edited = await editAsset(currentCode, prompt, model);

    // Save version + update asset
    await prisma.$transaction([
      prisma.assetVersion.create({
        data: {
          assetId,
          code: edited.code,
          jsCode: edited.jsCode,
          parameters: edited.parameters as any,
          prompt,
        },
      }),
      prisma.asset.update({
        where: { id: assetId },
        data: {
          code: edited.code,
          jsCode: edited.jsCode,
          parameters: edited.parameters as any,
          title: edited.title,
        },
      }),
      prisma.user.update({
        where: { id: user.id },
        data: {
          editUsage: { ...editUsage, [assetId]: editCount + 1 },
        },
      }),
    ]);

    return NextResponse.json({ ...edited, id: assetId });
  } catch (error: any) {
    console.error('Edit error:', error);
    return NextResponse.json({ error: error.message || 'Edit failed' }, { status: 500 });
  }
}
```

- [ ] **Step 10: Run all tests**

```bash
npx jest --no-coverage
```

Expected: All PASS

- [ ] **Step 11: Commit**

```bash
git add .
git commit -m "feat: add AI generation + edit pipeline with usage enforcement"
```

---

## Task 6: Remotion Player + Client Evaluator

**Files:**
- Create: `src/lib/remotion/evaluator.ts`
- Create: `src/remotion/UniversalComposition.tsx`
- Create: `src/components/studio/PlayerPanel.tsx`

- [ ] **Step 1: Create `src/lib/remotion/evaluator.ts`**

```typescript
'use client';
import * as RemotionLib from 'remotion';
import React from 'react';

type RemotionComponent = React.ComponentType<Record<string, unknown>>;

const componentCache = new Map<string, RemotionComponent>();

export function evaluateComponent(
  jsCode: string,
  params: Record<string, unknown>
): RemotionComponent | null {
  const cacheKey = jsCode.slice(0, 100) + JSON.stringify(params);
  if (componentCache.has(cacheKey)) return componentCache.get(cacheKey)!;

  try {
    // eslint-disable-next-line no-new-func
    const factory = new Function(
      'React',
      'remotion',
      `
      "use strict";
      const {
        useCurrentFrame, useVideoConfig, interpolate, interpolateColors,
        spring, AbsoluteFill, Sequence, Img, Easing
      } = remotion;

      ${jsCode}

      return typeof GeneratedAsset !== 'undefined'
        ? GeneratedAsset
        : typeof Component !== 'undefined'
        ? Component
        : null;
      `
    );

    const Component = factory(React, RemotionLib);
    if (typeof Component !== 'function') return null;

    // Wrap with defaultProps from params
    const Wrapped: RemotionComponent = (props) =>
      React.createElement(Component, { ...params, ...props });
    Wrapped.displayName = 'EvaluatedAsset';

    componentCache.set(cacheKey, Wrapped);
    return Wrapped;
  } catch (err) {
    console.error('Component evaluation failed:', err);
    return null;
  }
}

export function clearEvaluatorCache() {
  componentCache.clear();
}
```

- [ ] **Step 2: Create `src/remotion/UniversalComposition.tsx`**

```tsx
import React from 'react';
import { AbsoluteFill } from 'remotion';
import { evaluateComponent } from '@/lib/remotion/evaluator';

interface UniversalCompositionProps {
  jsCode: string;
  params: Record<string, unknown>;
}

export const UniversalComposition: React.FC<UniversalCompositionProps> = ({ jsCode, params }) => {
  const Component = evaluateComponent(jsCode, params);

  if (!Component) {
    return (
      <AbsoluteFill style={{ backgroundColor: '#1e1e2e', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#f38ba8', fontFamily: 'monospace', fontSize: 16 }}>
          Component evaluation failed
        </div>
      </AbsoluteFill>
    );
  }

  return <Component {...params} />;
};
```

- [ ] **Step 3: Create `src/components/studio/PlayerPanel.tsx`**

```tsx
'use client';
import React, { useState, useMemo } from 'react';
import { Player } from '@remotion/player';
import { evaluateComponent } from '@/lib/remotion/evaluator';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Play, Pause, RotateCcw, Expand, Grid3x3 } from 'lucide-react';
import type { GeneratedAsset } from '@/types';

interface PlayerPanelProps {
  asset: GeneratedAsset | null;
  paramValues: Record<string, unknown>;
  isGenerating: boolean;
}

const BACKGROUNDS = [
  { label: 'Dark', value: '#0f0f0f' },
  { label: 'Light', value: '#ffffff' },
  { label: 'Transparent', value: 'transparent' },
  { label: 'Checker', value: 'checker' },
];

export function PlayerPanel({ asset, paramValues, isGenerating }: PlayerPanelProps) {
  const [bg, setBg] = useState('#0f0f0f');
  const [isPlaying, setIsPlaying] = useState(true);

  const Component = useMemo(() => {
    if (!asset?.jsCode) return null;
    return evaluateComponent(asset.jsCode, paramValues);
  }, [asset?.jsCode, paramValues]);

  const backgroundStyle = bg === 'checker'
    ? { backgroundImage: 'linear-gradient(45deg, #888 25%, transparent 25%), linear-gradient(-45deg, #888 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #888 75%), linear-gradient(-45deg, transparent 75%, #888 75%)', backgroundSize: '20px 20px', backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px' }
    : { backgroundColor: bg };

  return (
    <div className="flex flex-col h-full bg-slate-900">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-700">
        <span className="text-xs text-slate-400 font-medium flex-1 truncate">
          {asset?.title || 'Preview'}
        </span>
        {asset && (
          <Badge variant="outline" className="text-xs border-slate-600 text-slate-400">
            {asset.fps}fps · {(asset.durationInFrames / asset.fps).toFixed(1)}s
          </Badge>
        )}
        <div className="flex gap-1 ml-2">
          {BACKGROUNDS.map(b => (
            <button
              key={b.value}
              title={b.label}
              onClick={() => setBg(b.value)}
              className={`w-5 h-5 rounded border text-xs ${bg === b.value ? 'border-violet-400' : 'border-slate-600'}`}
              style={b.value === 'checker'
                ? { backgroundImage: 'linear-gradient(45deg, #888 25%, transparent 25%)', backgroundSize: '8px 8px' }
                : { backgroundColor: b.value === 'transparent' ? '#666' : b.value }
              }
            >
              {b.value === 'checker' && <Grid3x3 className="h-3 w-3 text-white" />}
            </button>
          ))}
        </div>
      </div>

      {/* Player area */}
      <div className="flex-1 flex items-center justify-center p-4 overflow-hidden" style={backgroundStyle}>
        {isGenerating ? (
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-slate-400 text-sm">Generating animation...</span>
          </div>
        ) : Component ? (
          <div className="w-full h-full flex items-center justify-center">
            <div style={{ width: '100%', maxWidth: '100%', aspectRatio: `${asset!.width}/${asset!.height}` }}>
              <Player
                component={Component as React.ComponentType<Record<string, unknown>>}
                inputProps={paramValues}
                durationInFrames={asset!.durationInFrames}
                fps={asset!.fps}
                compositionWidth={asset!.width}
                compositionHeight={asset!.height}
                style={{ width: '100%', height: '100%' }}
                autoPlay
                loop
                controls
                clickToPlay
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 text-center max-w-sm">
            <div className="w-16 h-16 rounded-full bg-violet-900/30 flex items-center justify-center">
              <Play className="h-8 w-8 text-violet-400" />
            </div>
            <div>
              <p className="text-slate-300 font-medium">No animation yet</p>
              <p className="text-slate-500 text-sm mt-1">Enter a prompt and click Generate to create your animation</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/remotion/evaluator.ts src/remotion/ src/components/studio/PlayerPanel.tsx
git commit -m "feat: add Remotion Player with dynamic component evaluation"
```

---

## Task 7: Parameter UI Components

**Files:**
- Create: `src/components/studio/ParameterControl.tsx`
- Create: `src/components/studio/CustomizePanel.tsx`

- [ ] **Step 1: Create `src/components/studio/ParameterControl.tsx`**

```tsx
'use client';
import React from 'react';
import { HexColorPicker } from 'react-colorful';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { Parameter } from '@/types';

interface ParameterControlProps {
  param: Parameter;
  value: string | number | boolean;
  onChange: (value: string | number | boolean) => void;
  locked?: boolean;
}

export function ParameterControl({ param, value, onChange, locked }: ParameterControlProps) {
  if (locked) {
    return (
      <div className="opacity-50 pointer-events-none relative">
        <ControlContent param={param} value={value} onChange={onChange} />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs bg-violet-900/90 text-violet-200 px-2 py-0.5 rounded-full">Pro</span>
        </div>
      </div>
    );
  }

  return <ControlContent param={param} value={value} onChange={onChange} />;
}

function ControlContent({ param, value, onChange }: Omit<ParameterControlProps, 'locked'>) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-slate-400 font-medium">{param.label}</Label>

      {param.type === 'color' && (
        <Popover>
          <PopoverTrigger asChild>
            <button className="flex items-center gap-2 w-full px-3 py-2 rounded-md border border-slate-600 bg-slate-800 hover:bg-slate-700 transition-colors">
              <div
                className="w-5 h-5 rounded-sm border border-slate-500 flex-shrink-0"
                style={{ backgroundColor: value as string }}
              />
              <span className="text-sm text-slate-300 font-mono">{value as string}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-3 bg-slate-800 border-slate-600" side="left">
            <HexColorPicker color={value as string} onChange={onChange} />
            <Input
              value={value as string}
              onChange={e => onChange(e.target.value)}
              className="mt-2 bg-slate-700 border-slate-600 text-white font-mono text-xs"
              placeholder="#000000"
            />
          </PopoverContent>
        </Popover>
      )}

      {param.type === 'range' && (
        <div className="flex items-center gap-3">
          <Slider
            min={param.min ?? 0}
            max={param.max ?? 100}
            step={param.step ?? 0.1}
            value={[value as number]}
            onValueChange={([v]) => onChange(v)}
            className="flex-1"
          />
          <div className="flex items-center gap-1">
            <Input
              type="number"
              value={value as number}
              min={param.min}
              max={param.max}
              step={param.step ?? 0.1}
              onChange={e => onChange(parseFloat(e.target.value) || 0)}
              className="w-20 bg-slate-700 border-slate-600 text-white text-xs text-center"
            />
            {param.unit && <span className="text-xs text-slate-500">{param.unit}</span>}
          </div>
        </div>
      )}

      {param.type === 'text' && (
        <Input
          value={value as string}
          onChange={e => onChange(e.target.value)}
          className="bg-slate-700 border-slate-600 text-white"
        />
      )}

      {param.type === 'boolean' && (
        <div className="flex items-center gap-2">
          <Switch
            checked={value as boolean}
            onCheckedChange={onChange}
          />
          <span className="text-sm text-slate-400">{value ? 'On' : 'Off'}</span>
        </div>
      )}

      {param.type === 'select' && (
        <Select value={value as string} onValueChange={onChange}>
          <SelectTrigger className="bg-slate-700 border-slate-600 text-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-slate-800 border-slate-600">
            {param.options?.map(opt => (
              <SelectItem key={opt} value={opt} className="text-white hover:bg-slate-700">
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Install react-colorful popover deps**

```bash
npx shadcn@latest add popover
```

- [ ] **Step 3: Create `src/components/studio/CustomizePanel.tsx`**

```tsx
'use client';
import React from 'react';
import { ParameterControl } from './ParameterControl';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Lock, Palette, Ruler, Clock, Type, Settings2 } from 'lucide-react';
import type { Parameter, Tier } from '@/types';
import Link from 'next/link';

interface CustomizePanelProps {
  parameters: Parameter[];
  paramValues: Record<string, string | number | boolean>;
  onParamChange: (key: string, value: string | number | boolean) => void;
  tier: Tier;
}

const GROUP_META = {
  color:  { label: 'Colors',    Icon: Palette },
  size:   { label: 'Size',      Icon: Ruler },
  timing: { label: 'Timing',    Icon: Clock },
  text:   { label: 'Text',      Icon: Type },
  other:  { label: 'Settings',  Icon: Settings2 },
} as const;

const GROUP_ORDER: Parameter['group'][] = ['color', 'size', 'timing', 'text', 'other'];
const FREE_PARAM_LIMIT = 3;

export function CustomizePanel({ parameters, paramValues, onParamChange, tier }: CustomizePanelProps) {
  if (parameters.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6 gap-2">
        <Settings2 className="h-10 w-10 text-slate-600" />
        <p className="text-slate-400 text-sm">Generate an animation to see customization options</p>
      </div>
    );
  }

  const groupedParams: Record<string, Parameter[]> = {};
  for (const g of GROUP_ORDER) groupedParams[g] = [];
  for (const p of parameters) groupedParams[p.group].push(p);

  const visibleCount = tier === 'FREE' ? FREE_PARAM_LIMIT : parameters.length;
  let shownSoFar = 0;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
        <span className="text-sm font-semibold text-white">Customize</span>
        <Badge variant="outline" className="text-xs border-slate-600 text-slate-400">
          {parameters.length} params
        </Badge>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {GROUP_ORDER.map(group => {
          const groupParams = groupedParams[group];
          if (!groupParams?.length) return null;

          const { label, Icon } = GROUP_META[group];

          return (
            <div key={group}>
              <div className="flex items-center gap-2 mb-3">
                <Icon className="h-3.5 w-3.5 text-slate-500" />
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</span>
              </div>
              <div className="space-y-4">
                {groupParams.map(param => {
                  const isLocked = tier === 'FREE' && shownSoFar >= FREE_PARAM_LIMIT;
                  shownSoFar++;
                  return (
                    <ParameterControl
                      key={param.key}
                      param={param}
                      value={paramValues[param.key] ?? param.value}
                      onChange={val => onParamChange(param.key, val)}
                      locked={isLocked}
                    />
                  );
                })}
              </div>
              <Separator className="mt-4 bg-slate-700/50" />
            </div>
          );
        })}
      </div>

      {tier === 'FREE' && parameters.length > FREE_PARAM_LIMIT && (
        <div className="p-4 border-t border-slate-700 bg-slate-800/50">
          <p className="text-xs text-slate-400 mb-2">
            {parameters.length - FREE_PARAM_LIMIT} parameters locked on Free plan
          </p>
          <Button asChild size="sm" className="w-full bg-violet-600 hover:bg-violet-700 text-xs">
            <Link href="/pricing">Unlock all with Pro →</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add src/components/studio/
git commit -m "feat: add parameter UI controls (ColorPicker, Slider, Input, Switch, Select)"
```

---

## Task 8: Studio State + Prompt Panel

**Files:**
- Create: `src/hooks/useStudio.ts`
- Create: `src/components/studio/PromptPanel.tsx`
- Create: `src/components/studio/ExportPanel.tsx`

- [ ] **Step 1: Create `src/hooks/useStudio.ts`**

```typescript
'use client';
import { useReducer, useCallback } from 'react';
import type { StudioState, StudioAction, GeneratedAsset, AssetVersion } from '@/types';
import { toast } from 'sonner';

function studioReducer(state: StudioState, action: StudioAction): StudioState {
  switch (action.type) {
    case 'SET_GENERATING':
      return { ...state, isGenerating: action.payload, error: null };
    case 'SET_EDITING':
      return { ...state, isEditing: action.payload };
    case 'SET_EXPORTING':
      return { ...state, isExporting: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload, isGenerating: false, isEditing: false };
    case 'SET_ASSET': {
      const paramValues: Record<string, string | number | boolean> = {};
      for (const p of action.payload.parameters) {
        paramValues[p.key] = p.value;
      }
      return {
        ...state,
        asset: action.payload,
        paramValues,
        versions: [{
          id: action.payload.id,
          code: action.payload.code,
          jsCode: action.payload.jsCode,
          parameters: action.payload.parameters,
          prompt: '(initial)',
          createdAt: new Date().toISOString(),
        }],
        currentVersionIndex: 0,
        isGenerating: false,
        isEditing: false,
        error: null,
      };
    }
    case 'UPDATE_PARAM':
      return {
        ...state,
        paramValues: { ...state.paramValues, [action.payload.key]: action.payload.value },
      };
    case 'ADD_VERSION': {
      const newVersions = [...state.versions, action.payload];
      const paramValues: Record<string, string | number | boolean> = {};
      for (const p of action.payload.parameters) {
        paramValues[p.key] = p.value;
      }
      return {
        ...state,
        asset: state.asset ? {
          ...state.asset,
          code: action.payload.code,
          jsCode: action.payload.jsCode,
          parameters: action.payload.parameters,
        } : state.asset,
        paramValues,
        versions: newVersions,
        currentVersionIndex: newVersions.length - 1,
        isEditing: false,
      };
    }
    case 'RESTORE_VERSION': {
      const version = state.versions[action.payload];
      if (!version) return state;
      const paramValues: Record<string, string | number | boolean> = {};
      for (const p of version.parameters) {
        paramValues[p.key] = p.value;
      }
      return {
        ...state,
        asset: state.asset ? {
          ...state.asset,
          code: version.code,
          jsCode: version.jsCode,
          parameters: version.parameters,
        } : state.asset,
        paramValues,
        currentVersionIndex: action.payload,
      };
    }
    default:
      return state;
  }
}

const initialState: StudioState = {
  asset: null,
  versions: [],
  currentVersionIndex: -1,
  paramValues: {},
  isGenerating: false,
  isEditing: false,
  isExporting: false,
  error: null,
};

export function useStudio() {
  const [state, dispatch] = useReducer(studioReducer, initialState);

  const generate = useCallback(async (prompt: string) => {
    dispatch({ type: 'SET_GENERATING', payload: true });
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Generation failed');
      dispatch({ type: 'SET_ASSET', payload: data });
      toast.success('Animation created!');
    } catch (err: any) {
      dispatch({ type: 'SET_ERROR', payload: err.message });
      toast.error(err.message);
    }
  }, []);

  const edit = useCallback(async (prompt: string) => {
    if (!state.asset) return;
    dispatch({ type: 'SET_EDITING', payload: true });
    try {
      const res = await fetch('/api/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetId: state.asset.id,
          prompt,
          currentCode: state.asset.code,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Edit failed');

      dispatch({
        type: 'ADD_VERSION',
        payload: {
          id: crypto.randomUUID(),
          code: data.code,
          jsCode: data.jsCode,
          parameters: data.parameters,
          prompt,
          createdAt: new Date().toISOString(),
        },
      });
      toast.success('Animation updated!');
    } catch (err: any) {
      dispatch({ type: 'SET_ERROR', payload: err.message });
      toast.error(err.message);
    }
  }, [state.asset]);

  const updateParam = useCallback((key: string, value: string | number | boolean) => {
    dispatch({ type: 'UPDATE_PARAM', payload: { key, value } });
  }, []);

  const restoreVersion = useCallback((index: number) => {
    dispatch({ type: 'RESTORE_VERSION', payload: index });
    toast.success('Restored to previous version');
  }, []);

  return { state, generate, edit, updateParam, restoreVersion };
}
```

- [ ] **Step 2: Create `src/components/studio/PromptPanel.tsx`**

```tsx
'use client';
import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sparkles, Send, RotateCcw, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import type { AssetVersion, Tier } from '@/types';
import { TIER_LIMITS } from '@/lib/usage';

interface PromptPanelProps {
  onGenerate: (prompt: string) => void;
  onEdit: (prompt: string) => void;
  versions: AssetVersion[];
  currentVersionIndex: number;
  onRestoreVersion: (index: number) => void;
  isGenerating: boolean;
  isEditing: boolean;
  hasAsset: boolean;
  tier: Tier;
}

const EXAMPLE_PROMPTS = [
  'Animated counter from 0 to 100 with spring effect',
  'Comic book explosion effect text: POW!',
  'Animated bar chart showing monthly revenue',
  'Gradient blob background animation',
  'Logo reveal with particle effect',
  'Neon text glow animation',
];

export function PromptPanel({
  onGenerate, onEdit, versions, currentVersionIndex,
  onRestoreVersion, isGenerating, isEditing, hasAsset, tier,
}: PromptPanelProps) {
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<'generate' | 'edit'>('generate');
  const [showHistory, setShowHistory] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (hasAsset) setMode('edit');
  }, [hasAsset]);

  const isLoading = isGenerating || isEditing;
  const editCount = versions.length > 0 ? versions.length - 1 : 0;
  const editLimit = tier === 'FREE' ? TIER_LIMITS.FREE.editsPerAsset : '∞';

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || isLoading) return;
    if (mode === 'generate' || !hasAsset) {
      onGenerate(prompt.trim());
    } else {
      onEdit(prompt.trim());
    }
    setPrompt('');
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSubmit(e as any);
    }
  }

  return (
    <div className="flex flex-col h-full bg-slate-900">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-700">
        <Sparkles className="h-4 w-4 text-violet-400" />
        <span className="text-sm font-semibold text-white">Prompt</span>
        {hasAsset && (
          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => setMode('generate')}
              className={`text-xs px-2.5 py-1 rounded-md transition-colors ${mode === 'generate' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              New
            </button>
            <button
              onClick={() => setMode('edit')}
              className={`text-xs px-2.5 py-1 rounded-md transition-colors ${mode === 'edit' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              Edit {tier === 'FREE' && `(${editCount}/${editLimit})`}
            </button>
          </div>
        )}
      </div>

      {/* Version History */}
      {versions.length > 1 && (
        <div className="border-b border-slate-700">
          <button
            onClick={() => setShowHistory(v => !v)}
            className="flex items-center gap-2 w-full px-4 py-2 text-xs text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <RotateCcw className="h-3 w-3" />
            Version history ({versions.length})
            {showHistory ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
          </button>
          {showHistory && (
            <ScrollArea className="max-h-48">
              {[...versions].reverse().map((version, reversedIdx) => {
                const idx = versions.length - 1 - reversedIdx;
                const isCurrent = idx === currentVersionIndex;
                return (
                  <button
                    key={version.id}
                    onClick={() => onRestoreVersion(idx)}
                    className={`w-full text-left px-4 py-2 text-xs transition-colors ${
                      isCurrent ? 'bg-violet-900/30 text-violet-300' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    <span className="text-slate-500 mr-2">v{idx + 1}</span>
                    <span className="truncate">{version.prompt}</span>
                    {isCurrent && <Badge className="ml-2 text-[10px] bg-violet-600 py-0">current</Badge>}
                  </button>
                );
              })}
            </ScrollArea>
          )}
        </div>
      )}

      {/* Example prompts (when empty) */}
      {!hasAsset && (
        <div className="px-4 py-3 border-b border-slate-700">
          <p className="text-xs text-slate-500 mb-2">Try an example:</p>
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLE_PROMPTS.slice(0, 3).map(p => (
              <button
                key={p}
                onClick={() => setPrompt(p)}
                className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-2.5 py-1 rounded-full border border-slate-600 transition-colors"
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input form */}
      <form onSubmit={handleSubmit} className="flex-1 flex flex-col p-4 gap-3">
        <Textarea
          ref={textareaRef}
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            mode === 'generate' || !hasAsset
              ? 'Describe your animation...\ne.g. "Animated counter from 0 to 1000 with spring physics"'
              : 'Describe your changes...\ne.g. "Make the color blue and add a glow effect"'
          }
          className="flex-1 resize-none bg-slate-800 border-slate-600 text-white placeholder:text-slate-500 min-h-[120px]"
          disabled={isLoading}
        />
        <Button
          type="submit"
          disabled={!prompt.trim() || isLoading}
          className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-50"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              {isGenerating ? 'Generating...' : 'Editing...'}
            </>
          ) : (
            <>
              <Send className="h-4 w-4 mr-2" />
              {mode === 'generate' || !hasAsset ? 'Generate' : 'Apply Changes'}
              <span className="ml-auto text-xs opacity-60">⌘↵</span>
            </>
          )}
        </Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Create `src/components/studio/ExportPanel.tsx`**

```tsx
'use client';
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Download, Code, Globe, Film, Lock, Check, Copy } from 'lucide-react';
import type { GeneratedAsset, ExportFormat, Tier } from '@/types';
import { toast } from 'sonner';

interface ExportPanelProps {
  asset: GeneratedAsset | null;
  paramValues: Record<string, string | number | boolean>;
  tier: Tier;
}

interface FormatOption {
  id: ExportFormat;
  label: string;
  description: string;
  tier: 'free' | 'pro';
  Icon: React.ComponentType<{ className?: string }>;
  serverRender: boolean;
}

const FORMAT_OPTIONS: FormatOption[] = [
  { id: 'react', label: 'React Component', description: 'Download as .tsx file', tier: 'free', Icon: Code, serverRender: false },
  { id: 'gif', label: 'Animated GIF', description: 'With watermark on Free', tier: 'free', Icon: Film, serverRender: true },
  { id: 'mp4', label: 'MP4 Video', description: '1080p H.264', tier: 'pro', Icon: Film, serverRender: true },
  { id: 'webm', label: 'WebM (Alpha)', description: 'Transparent background', tier: 'pro', Icon: Film, serverRender: true },
];

function EmbedCode({ assetId }: { assetId: string }) {
  const [copied, setCopied] = useState(false);
  const embedCode = `<script src="https://easymake.app/embed.js"></script>\n<easymake-player id="${assetId}"></easymake-player>`;

  function copy() {
    navigator.clipboard.writeText(embedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('Embed code copied!');
  }

  return (
    <div className="mt-4 space-y-2">
      <div className="flex items-center gap-2">
        <Globe className="h-3.5 w-3.5 text-slate-400" />
        <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">Web Embed</span>
        <Badge variant="outline" className="text-[10px] border-green-600 text-green-400 ml-auto">Free</Badge>
      </div>
      <div className="relative bg-slate-900 rounded-md p-3 font-mono text-xs text-slate-300 break-all border border-slate-700">
        {embedCode}
        <button onClick={copy} className="absolute top-2 right-2 p-1 hover:bg-slate-700 rounded">
          {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5 text-slate-400" />}
        </button>
      </div>
    </div>
  );
}

export function ExportPanel({ asset, paramValues, tier }: ExportPanelProps) {
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [progress, setProgress] = useState(0);

  if (!asset) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6 gap-2">
        <Download className="h-10 w-10 text-slate-600" />
        <p className="text-slate-400 text-sm">Generate an animation to export</p>
      </div>
    );
  }

  async function handleExport(format: ExportFormat) {
    if (!asset) return;

    if (format === 'react') {
      // Direct code download
      const blob = new Blob([asset.code], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${asset.title.replace(/\s+/g, '_')}.tsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Component downloaded!');
      return;
    }

    setExporting(format);
    setProgress(10);

    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId: asset.id, format, paramValues }),
      });

      setProgress(80);

      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error);
      }

      const blob = await res.blob();
      setProgress(100);

      const ext = { gif: 'gif', mp4: 'mp4', webm: 'webm' }[format];
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${asset.title.replace(/\s+/g, '_')}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);

      toast.success(`${format.toUpperCase()} downloaded!`);
    } catch (err: any) {
      toast.error(err.message || 'Export failed');
    } finally {
      setTimeout(() => {
        setExporting(null);
        setProgress(0);
      }, 500);
    }
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2 mb-4">
        <Download className="h-4 w-4 text-slate-400" />
        <span className="text-sm font-semibold text-white">Export</span>
      </div>

      {FORMAT_OPTIONS.map(fmt => {
        const isLocked = fmt.tier === 'pro' && tier === 'FREE';
        const isExportingThis = exporting === fmt.id;

        return (
          <div
            key={fmt.id}
            className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
              isLocked ? 'border-slate-700 opacity-60' : 'border-slate-600 hover:border-violet-600 hover:bg-violet-950/20'
            }`}
          >
            <fmt.Icon className="h-5 w-5 text-slate-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-white">{fmt.label}</span>
                {fmt.tier === 'pro' && (
                  <Badge className="text-[10px] bg-violet-900 text-violet-300 py-0">Pro</Badge>
                )}
                {fmt.tier === 'free' && (
                  <Badge variant="outline" className="text-[10px] border-green-700 text-green-400 py-0">Free</Badge>
                )}
              </div>
              <p className="text-xs text-slate-400">{fmt.description}</p>
            </div>
            <Button
              size="sm"
              disabled={isLocked || isExportingThis || !!exporting}
              onClick={() => handleExport(fmt.id)}
              className={isLocked ? 'bg-slate-700 cursor-not-allowed' : 'bg-violet-600 hover:bg-violet-700'}
            >
              {isLocked ? (
                <Lock className="h-3.5 w-3.5" />
              ) : isExportingThis ? (
                <span className="text-xs">...</span>
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        );
      })}

      {exporting && (
        <div className="space-y-1.5 mt-2">
          <div className="flex justify-between text-xs text-slate-400">
            <span>Rendering {exporting}...</span>
            <span>{progress}%</span>
          </div>
          <Progress value={progress} className="h-1.5" />
        </div>
      )}

      <EmbedCode assetId={asset.id} />
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/hooks/ src/components/studio/
git commit -m "feat: add studio state management, prompt panel, and export panel"
```

---

## Task 9: Export API (SSR Renderer)

**Files:**
- Create: `src/app/api/export/route.ts`
- Create: `src/app/api/assets/route.ts`

- [ ] **Step 1: Create `src/app/api/export/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

export const runtime = 'nodejs';
export const maxDuration = 120;

const FREE_FORMATS = ['gif', 'react'];
const PRO_FORMATS = ['mp4', 'webm'];

let bundleCache: string | null = null;

async function getBundlePath(): Promise<string> {
  if (bundleCache) return bundleCache;

  const entryPoint = path.resolve(process.cwd(), 'src/remotion/UniversalComposition.tsx');
  bundleCache = await bundle({
    entryPoint,
    webpackOverride: (config) => config,
  });

  return bundleCache;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { assetId, format, paramValues } = await req.json();

  if (format === 'react') {
    return NextResponse.json({ error: 'React export handled client-side' }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  if (PRO_FORMATS.includes(format) && user.tier !== 'PRO') {
    return NextResponse.json({ error: `${format.toUpperCase()} export requires Pro plan` }, { status: 403 });
  }

  const asset = await prisma.asset.findUnique({ where: { id: assetId, userId: user.id } });
  if (!asset) return NextResponse.json({ error: 'Asset not found' }, { status: 404 });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'easymake-'));
  const outPath = path.join(tmpDir, `output.${format}`);

  try {
    const bundlePath = await getBundlePath();

    const codec = format === 'gif' ? 'gif' : format === 'webm' ? 'vp8' : 'h264';
    const mimeType = format === 'gif' ? 'image/gif' : format === 'webm' ? 'video/webm' : 'video/mp4';

    const inputProps = {
      jsCode: asset.jsCode,
      params: paramValues || {},
    };

    const composition = await selectComposition({
      serveUrl: bundlePath,
      id: 'UniversalComposition',
      inputProps,
    });

    await renderMedia({
      composition,
      serveUrl: bundlePath,
      codec,
      outputLocation: outPath,
      inputProps,
      ...(format === 'gif' ? { imageFormat: 'png' } : {}),
    });

    const fileBuffer = await fs.readFile(outPath);
    const filename = `${asset.title.replace(/\s+/g, '_')}.${format}`;

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': fileBuffer.length.toString(),
      },
    });
  } catch (err: any) {
    console.error('Export error:', err);
    return NextResponse.json({ error: err.message || 'Export failed' }, { status: 500 });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
```

- [ ] **Step 2: Register composition in `src/remotion/UniversalComposition.tsx`** (update existing file)

```tsx
import React from 'react';
import { Composition } from 'remotion';
import { AbsoluteFill } from 'remotion';
import { evaluateComponent } from '@/lib/remotion/evaluator';

interface Props {
  jsCode: string;
  params: Record<string, unknown>;
}

export const UniversalComposition: React.FC<Props> = ({ jsCode, params }) => {
  const Component = evaluateComponent(jsCode, params);
  if (!Component) {
    return (
      <AbsoluteFill style={{ backgroundColor: '#1e1e2e', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#f38ba8', fontFamily: 'monospace', fontSize: 16 }}>Error</div>
      </AbsoluteFill>
    );
  }
  return <Component {...params} />;
};

export const RemotionRoot: React.FC = () => (
  <Composition
    id="UniversalComposition"
    component={UniversalComposition}
    durationInFrames={150}
    fps={30}
    width={1920}
    height={1080}
    defaultProps={{ jsCode: '', params: {} }}
  />
);
```

- [ ] **Step 3: Create `src/app/api/assets/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const assets = await prisma.asset.findMany({
    where: { userId: session.user.id },
    orderBy: { updatedAt: 'desc' },
    include: {
      _count: { select: { versions: true } },
    },
  });

  return NextResponse.json(assets);
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/
git commit -m "feat: add export API with Remotion SSR renderer (GIF/MP4/WebM)"
```

---

## Task 10: Studio Page Assembly

**Files:**
- Create: `src/components/studio/Studio.tsx`
- Create: `src/app/studio/page.tsx`

- [ ] **Step 1: Create `src/components/studio/Studio.tsx`**

```tsx
'use client';
import React, { useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { PromptPanel } from './PromptPanel';
import { PlayerPanel } from './PlayerPanel';
import { CustomizePanel } from './CustomizePanel';
import { ExportPanel } from './ExportPanel';
import { useStudio } from '@/hooks/useStudio';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Zap, Settings2, Download, LayoutPanelLeft, Menu, X } from 'lucide-react';
import type { Tier } from '@/types';
import Link from 'next/link';

interface StudioProps {
  tier: Tier;
  userImage?: string | null;
  userName?: string | null;
}

export function Studio({ tier, userImage, userName }: StudioProps) {
  const { state, generate, edit, updateParam, restoreVersion } = useStudio();
  const [mobileTab, setMobileTab] = useState<'prompt' | 'customize' | 'export'>('prompt');

  return (
    <div className="flex flex-col h-screen bg-slate-950">
      {/* Top bar */}
      <header className="flex items-center gap-3 px-4 py-2 border-b border-slate-800 bg-slate-900 flex-shrink-0">
        <Link href="/" className="flex items-center gap-1.5">
          <Zap className="h-5 w-5 text-violet-400" />
          <span className="font-bold text-white text-sm">EasyMake</span>
        </Link>

        <div className="flex items-center gap-1.5 ml-3">
          {tier === 'FREE' ? (
            <>
              <span className="text-xs text-slate-400">Free Plan</span>
              <Button asChild size="sm" className="h-7 text-xs bg-violet-600 hover:bg-violet-700 px-3">
                <Link href="/pricing">Upgrade to Pro</Link>
              </Button>
            </>
          ) : (
            <span className="text-xs text-violet-300 bg-violet-900/40 px-2 py-0.5 rounded-full">Pro</span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {state.asset && (
            <span className="text-xs text-slate-400 hidden sm:block truncate max-w-[200px]">
              {state.asset.title}
            </span>
          )}
          {userImage ? (
            <img src={userImage} alt="" className="w-7 h-7 rounded-full border border-slate-600" />
          ) : (
            <div className="w-7 h-7 rounded-full bg-violet-700 flex items-center justify-center text-xs text-white">
              {userName?.[0]?.toUpperCase() ?? 'U'}
            </div>
          )}
          <Link href="/dashboard" className="text-xs text-slate-400 hover:text-white transition-colors hidden sm:block">
            Dashboard
          </Link>
        </div>
      </header>

      {/* Desktop: 3-panel layout */}
      <div className="flex-1 overflow-hidden hidden md:block">
        <PanelGroup direction="horizontal" className="h-full">
          {/* Left: Prompt Panel */}
          <Panel defaultSize={22} minSize={18} maxSize={35}>
            <div className="h-full border-r border-slate-800">
              <PromptPanel
                onGenerate={generate}
                onEdit={edit}
                versions={state.versions}
                currentVersionIndex={state.currentVersionIndex}
                onRestoreVersion={restoreVersion}
                isGenerating={state.isGenerating}
                isEditing={state.isEditing}
                hasAsset={!!state.asset}
                tier={tier}
              />
            </div>
          </Panel>

          <PanelResizeHandle className="w-1 bg-slate-800 hover:bg-violet-600 transition-colors cursor-col-resize" />

          {/* Center: Player */}
          <Panel defaultSize={52} minSize={35}>
            <PlayerPanel
              asset={state.asset}
              paramValues={state.paramValues as Record<string, unknown>}
              isGenerating={state.isGenerating}
            />
          </Panel>

          <PanelResizeHandle className="w-1 bg-slate-800 hover:bg-violet-600 transition-colors cursor-col-resize" />

          {/* Right: Customize + Export */}
          <Panel defaultSize={26} minSize={20} maxSize={40}>
            <div className="h-full border-l border-slate-800 flex flex-col">
              <Tabs defaultValue="customize" className="flex flex-col h-full">
                <TabsList className="w-full bg-slate-800 rounded-none border-b border-slate-700 flex-shrink-0">
                  <TabsTrigger value="customize" className="flex-1 text-xs data-[state=active]:bg-slate-900">
                    <Settings2 className="h-3.5 w-3.5 mr-1.5" />
                    Customize
                  </TabsTrigger>
                  <TabsTrigger value="export" className="flex-1 text-xs data-[state=active]:bg-slate-900">
                    <Download className="h-3.5 w-3.5 mr-1.5" />
                    Export
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="customize" className="flex-1 overflow-y-auto m-0">
                  <CustomizePanel
                    parameters={state.asset?.parameters ?? []}
                    paramValues={state.paramValues}
                    onParamChange={updateParam}
                    tier={tier}
                  />
                </TabsContent>

                <TabsContent value="export" className="flex-1 overflow-y-auto m-0">
                  <ExportPanel
                    asset={state.asset}
                    paramValues={state.paramValues}
                    tier={tier}
                  />
                </TabsContent>
              </Tabs>
            </div>
          </Panel>
        </PanelGroup>
      </div>

      {/* Mobile: tab-based layout */}
      <div className="flex-1 overflow-hidden md:hidden flex flex-col">
        <div className="flex-1 overflow-hidden">
          {mobileTab === 'prompt' && (
            <PromptPanel
              onGenerate={generate}
              onEdit={edit}
              versions={state.versions}
              currentVersionIndex={state.currentVersionIndex}
              onRestoreVersion={restoreVersion}
              isGenerating={state.isGenerating}
              isEditing={state.isEditing}
              hasAsset={!!state.asset}
              tier={tier}
            />
          )}
          {mobileTab === 'customize' && (
            <>
              <div className="h-64 border-b border-slate-800">
                <PlayerPanel
                  asset={state.asset}
                  paramValues={state.paramValues as Record<string, unknown>}
                  isGenerating={state.isGenerating}
                />
              </div>
              <div className="flex-1 overflow-y-auto">
                <CustomizePanel
                  parameters={state.asset?.parameters ?? []}
                  paramValues={state.paramValues}
                  onParamChange={updateParam}
                  tier={tier}
                />
              </div>
            </>
          )}
          {mobileTab === 'export' && (
            <ExportPanel
              asset={state.asset}
              paramValues={state.paramValues}
              tier={tier}
            />
          )}
        </div>

        {/* Mobile nav */}
        <div className="flex border-t border-slate-800 bg-slate-900 flex-shrink-0">
          {[
            { id: 'prompt' as const, label: 'Prompt', Icon: Zap },
            { id: 'customize' as const, label: 'Customize', Icon: Settings2 },
            { id: 'export' as const, label: 'Export', Icon: Download },
          ].map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setMobileTab(id)}
              className={`flex-1 flex flex-col items-center gap-1 py-2 text-xs transition-colors ${
                mobileTab === id ? 'text-violet-400' : 'text-slate-500'
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `src/app/studio/page.tsx`**

```tsx
import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { Studio } from '@/components/studio/Studio';
import type { Tier } from '@/types';

export default async function StudioPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  return (
    <Studio
      tier={(session.user.tier || 'FREE') as Tier}
      userImage={session.user.image}
      userName={session.user.name}
    />
  );
}
```

- [ ] **Step 3: Verify studio renders**

```bash
npm run dev
```

Navigate to http://localhost:3000/studio — should see the 3-panel studio layout.

- [ ] **Step 4: Commit**

```bash
git add src/app/studio/ src/components/studio/Studio.tsx
git commit -m "feat: assemble full studio page with 3-panel resizable layout"
```

---

## Task 11: Built-in Templates

**Files:**
- Create: `src/remotion/templates/CounterAnimation.tsx`
- Create: `src/remotion/templates/ComicEffect.tsx`
- Create: `src/remotion/templates/BarChart.tsx`
- Create: `src/lib/templates.ts`

- [ ] **Step 1: Create `src/remotion/templates/CounterAnimation.tsx`**

```tsx
import { useCurrentFrame, useVideoConfig, interpolate, spring, AbsoluteFill } from 'remotion';

const PARAMS = {
  targetNumber: 1000,           // type: range, min: 1, max: 100000
  prefix: "$",                  // type: text
  suffix: "K",                  // type: text
  primaryColor: "#7C3AED",      // type: color
  backgroundColor: "#0f0f17",   // type: color
  fontSize: 120,                // type: range, min: 40, max: 240, unit: px
  speed: 1.0,                   // type: range, min: 0.3, max: 3.0
  showDecimal: false,           // type: boolean
} as const;

export const CounterAnimation = ({
  targetNumber = PARAMS.targetNumber,
  prefix = PARAMS.prefix,
  suffix = PARAMS.suffix,
  primaryColor = PARAMS.primaryColor,
  backgroundColor = PARAMS.backgroundColor,
  fontSize = PARAMS.fontSize,
  speed = PARAMS.speed,
  showDecimal = PARAMS.showDecimal,
}: typeof PARAMS = PARAMS) => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();

  const progress = spring({
    fps,
    frame: frame * speed,
    config: { damping: 200, stiffness: 80, mass: 1 },
    durationInFrames: durationInFrames * 0.8,
  });

  const currentValue = progress * (targetNumber as number);
  const displayValue = showDecimal
    ? currentValue.toFixed(1)
    : Math.round(currentValue).toLocaleString();

  const scale = interpolate(frame, [0, 10], [0.8, 1], { extrapolateRight: 'clamp' });
  const opacity = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ backgroundColor: backgroundColor as string, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ transform: `scale(${scale})`, opacity, textAlign: 'center' }}>
        <div style={{
          fontSize: fontSize as number,
          fontWeight: 900,
          color: primaryColor as string,
          fontFamily: 'system-ui, sans-serif',
          lineHeight: 1,
          letterSpacing: '-0.02em',
        }}>
          {prefix}{displayValue}{suffix}
        </div>
        <div style={{
          height: 4,
          backgroundColor: primaryColor as string,
          borderRadius: 2,
          width: `${progress * 100}%`,
          marginTop: 16,
          transition: 'width 0.1s',
        }} />
      </div>
    </AbsoluteFill>
  );
};
```

- [ ] **Step 2: Create `src/remotion/templates/ComicEffect.tsx`**

```tsx
import { useCurrentFrame, useVideoConfig, interpolate, spring, AbsoluteFill } from 'remotion';

const PARAMS = {
  text: "POW!",               // type: text
  primaryColor: "#FFE11A",    // type: color
  strokeColor: "#1A0066",     // type: color
  backgroundColor: "#FF3366", // type: color
  size: 1.0,                  // type: range, min: 0.3, max: 2.0
  rotation: -8,               // type: range, min: -30, max: 30
} as const;

export const ComicEffect = ({
  text = PARAMS.text,
  primaryColor = PARAMS.primaryColor,
  strokeColor = PARAMS.strokeColor,
  backgroundColor = PARAMS.backgroundColor,
  size = PARAMS.size,
  rotation = PARAMS.rotation,
}: typeof PARAMS = PARAMS) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const scale = spring({ fps, frame, config: { damping: 8, stiffness: 300, mass: 0.5 } });
  const burstScale = spring({ fps, frame: frame - 3, config: { damping: 15, stiffness: 200 } });

  const wobble = Math.sin(frame * 0.4) * 2;

  const numRays = 20;
  const rays = Array.from({ length: numRays }, (_, i) => {
    const angle = (i / numRays) * 360;
    const length = 380 + Math.sin(i * 1.7) * 60;
    return { angle, length };
  });

  return (
    <AbsoluteFill style={{ backgroundColor: backgroundColor as string, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {/* Burst rays */}
      <div style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transform: `scale(${burstScale * (size as number)})`,
      }}>
        <svg viewBox="-500 -500 1000 1000" style={{ position: 'absolute', width: '100%', height: '100%' }}>
          {rays.map((ray, i) => {
            const rad = (ray.angle * Math.PI) / 180;
            const x2 = Math.cos(rad) * ray.length;
            const y2 = Math.sin(rad) * ray.length;
            return (
              <line
                key={i}
                x1={0} y1={0} x2={x2} y2={y2}
                stroke={primaryColor as string}
                strokeWidth={i % 2 === 0 ? 28 : 14}
                opacity={0.6 + (i % 3) * 0.1}
              />
            );
          })}
        </svg>
      </div>

      {/* Main text */}
      <div style={{
        transform: `scale(${scale * (size as number)}) rotate(${(rotation as number) + wobble}deg)`,
        fontSize: 140,
        fontWeight: 900,
        fontFamily: 'Impact, "Arial Black", sans-serif',
        color: primaryColor as string,
        WebkitTextStroke: `6px ${strokeColor}`,
        textShadow: `6px 6px 0 ${strokeColor}, -2px -2px 0 ${strokeColor}`,
        letterSpacing: '-0.02em',
        userSelect: 'none',
        zIndex: 1,
        position: 'relative',
      }}>
        {text}
      </div>
    </AbsoluteFill>
  );
};
```

- [ ] **Step 3: Create `src/remotion/templates/BarChart.tsx`**

```tsx
import { useCurrentFrame, useVideoConfig, interpolate, spring, AbsoluteFill, Sequence } from 'remotion';

const PARAMS = {
  values: "42,78,56,91,63",     // type: text
  labels: "Mon,Tue,Wed,Thu,Fri", // type: text
  primaryColor: "#7C3AED",       // type: color
  secondaryColor: "#A78BFA",     // type: color
  backgroundColor: "#0f0f17",    // type: color
  title: "Weekly Progress",      // type: text
  showValues: true,              // type: boolean
  animSpeed: 1.0,                // type: range, min: 0.3, max: 3.0
} as const;

export const BarChart = ({
  values = PARAMS.values,
  labels = PARAMS.labels,
  primaryColor = PARAMS.primaryColor,
  secondaryColor = PARAMS.secondaryColor,
  backgroundColor = PARAMS.backgroundColor,
  title = PARAMS.title,
  showValues = PARAMS.showValues,
  animSpeed = PARAMS.animSpeed,
}: typeof PARAMS = PARAMS) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const parsedValues = String(values).split(',').map(v => parseFloat(v.trim()) || 0);
  const parsedLabels = String(labels).split(',').map(l => l.trim());
  const maxValue = Math.max(...parsedValues, 1);

  const titleOpacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: 'clamp' });
  const titleY = interpolate(frame, [0, 15], [20, 0], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{
      backgroundColor: backgroundColor as string,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '80px 100px 100px',
      fontFamily: 'system-ui, sans-serif',
    }}>
      {/* Title */}
      <div style={{
        color: 'white',
        fontSize: 48,
        fontWeight: 700,
        marginBottom: 60,
        opacity: titleOpacity,
        transform: `translateY(${titleY}px)`,
        letterSpacing: '-0.02em',
      }}>
        {title}
      </div>

      {/* Bars */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 32, width: '100%', height: 400 }}>
        {parsedValues.map((value, i) => {
          const barFrame = frame - i * (6 / (animSpeed as number));
          const barHeight = spring({
            fps,
            frame: Math.max(0, barFrame),
            config: { damping: 20, stiffness: 120 },
          });

          const heightPercent = (value / maxValue) * barHeight;
          const label = parsedLabels[i] || `Item ${i + 1}`;

          const color = interpolate(i, [0, parsedValues.length - 1], [0, 1]);
          const barColor = i % 2 === 0 ? primaryColor : secondaryColor;

          return (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
              {showValues && (
                <div style={{
                  color: 'white',
                  fontSize: 28,
                  fontWeight: 700,
                  opacity: barHeight,
                }}>
                  {Math.round(value * barHeight)}
                </div>
              )}
              <div style={{
                width: '100%',
                height: `${heightPercent * 100}%`,
                backgroundColor: barColor as string,
                borderRadius: '8px 8px 0 0',
                minHeight: 4,
                boxShadow: `0 0 20px ${barColor}66`,
              }} />
              <div style={{ color: '#9ca3af', fontSize: 24, fontWeight: 500 }}>{label}</div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
```

- [ ] **Step 4: Create `src/lib/templates.ts`**

```typescript
import { transpileTSX } from '@/lib/remotion/transpiler';
import { sanitizeCode } from '@/lib/remotion/sandbox';
import type { Template, Parameter } from '@/types';
import fs from 'fs';
import path from 'path';

async function loadTemplate(filename: string, meta: Omit<Template, 'code' | 'jsCode' | 'parameters'>): Promise<Template> {
  const filePath = path.join(process.cwd(), 'src/remotion/templates', filename);
  const code = fs.readFileSync(filePath, 'utf-8');

  const sanitized = sanitizeCode(code);
  const jsCode = await transpileTSX(sanitized);

  // Extract parameters from PARAMS const
  const paramsMatch = code.match(/const PARAMS\s*=\s*\{([\s\S]*?)\}\s*as const/);
  const parameters: Parameter[] = [];

  if (paramsMatch) {
    const lines = paramsMatch[1].split('\n');
    for (const line of lines) {
      const match = line.match(/^\s*(\w+)\s*:\s*(.+?),?\s*\/\/\s*type:\s*(\w+)(.*?)$/);
      if (!match) continue;
      const [, key, rawValue, typeStr, rest] = match;

      const minMatch = rest.match(/min:\s*([\d.]+)/);
      const maxMatch = rest.match(/max:\s*([\d.]+)/);
      const unitMatch = rest.match(/unit:\s*(\w+)/);
      const optionsMatch = rest.match(/options:\s*([\w|]+)/);
      const type = typeStr as Parameter['type'];

      const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim();
      let group: Parameter['group'] = 'other';
      if (type === 'color') group = 'color';
      else if (key.toLowerCase().includes('size') || key.toLowerCase().includes('font')) group = 'size';
      else if (key.toLowerCase().includes('speed') || key.toLowerCase().includes('duration')) group = 'timing';
      else if (type === 'text') group = 'text';

      const value = type === 'color' ? rawValue.replace(/['"]/g, '')
        : type === 'boolean' ? rawValue.trim() === 'true'
        : type === 'text' ? rawValue.replace(/['"]/g, '')
        : parseFloat(rawValue) || 0;

      parameters.push({
        key, label, group, type, value,
        min: minMatch ? parseFloat(minMatch[1]) : undefined,
        max: maxMatch ? parseFloat(maxMatch[1]) : undefined,
        unit: unitMatch?.[1],
        options: optionsMatch ? optionsMatch[1].split('|') : undefined,
      });
    }
  }

  return { ...meta, code, jsCode, parameters };
}

let _templates: Template[] | null = null;

export async function getTemplates(): Promise<Template[]> {
  if (_templates) return _templates;

  _templates = await Promise.all([
    loadTemplate('CounterAnimation.tsx', {
      id: 'counter-animation',
      title: 'Counter Animation',
      description: 'Animated number counter with spring physics',
      category: 'counter',
      durationInFrames: 150,
      fps: 30,
      width: 1920,
      height: 1080,
    }),
    loadTemplate('ComicEffect.tsx', {
      id: 'comic-effect',
      title: 'Comic Effect',
      description: 'Explosive comic book sound effect',
      category: 'text',
      durationInFrames: 90,
      fps: 30,
      width: 1920,
      height: 1080,
    }),
    loadTemplate('BarChart.tsx', {
      id: 'bar-chart',
      title: 'Bar Chart',
      description: 'Animated bar chart with spring animation',
      category: 'chart',
      durationInFrames: 150,
      fps: 30,
      width: 1920,
      height: 1080,
    }),
  ]);

  return _templates;
}
```

- [ ] **Step 5: Commit**

```bash
git add src/remotion/ src/lib/templates.ts
git commit -m "feat: add 3 built-in templates (Counter, ComicEffect, BarChart)"
```

---

## Task 12: Landing Page + Template Gallery

**Files:**
- Create: `src/components/gallery/TemplateCard.tsx`
- Create: `src/components/gallery/FilterBar.tsx`
- Create: `src/app/(marketing)/page.tsx`
- Create: `src/app/(marketing)/layout.tsx`

- [ ] **Step 1: Create `src/app/(marketing)/layout.tsx`**

```tsx
import Link from 'next/link';
import { auth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Zap } from 'lucide-react';

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  return (
    <div className="min-h-screen bg-slate-950">
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center gap-4 px-6 py-4 bg-slate-950/80 backdrop-blur-sm border-b border-slate-800">
        <Link href="/" className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-violet-400" />
          <span className="font-bold text-white">EasyMake</span>
        </Link>
        <nav className="hidden md:flex items-center gap-6 ml-8">
          <Link href="/pricing" className="text-sm text-slate-400 hover:text-white transition-colors">Pricing</Link>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          {session ? (
            <Button asChild className="bg-violet-600 hover:bg-violet-700">
              <Link href="/studio">Open Studio</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" className="text-slate-300 hover:text-white">
                <Link href="/login">Sign In</Link>
              </Button>
              <Button asChild className="bg-violet-600 hover:bg-violet-700">
                <Link href="/login">Get Started Free</Link>
              </Button>
            </>
          )}
        </div>
      </nav>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Create `src/components/gallery/FilterBar.tsx`**

```tsx
'use client';
import React from 'react';
import { Button } from '@/components/ui/button';

const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'counter', label: 'Counter' },
  { id: 'text', label: 'Text FX' },
  { id: 'chart', label: 'Charts' },
  { id: 'background', label: 'Background' },
  { id: 'logo', label: 'Logo' },
] as const;

type Category = typeof CATEGORIES[number]['id'];

interface FilterBarProps {
  active: Category;
  onChange: (cat: Category) => void;
}

export function FilterBar({ active, onChange }: FilterBarProps) {
  return (
    <div className="flex gap-2 flex-wrap">
      {CATEGORIES.map(cat => (
        <button
          key={cat.id}
          onClick={() => onChange(cat.id)}
          className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
            active === cat.id
              ? 'bg-violet-600 text-white'
              : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'
          }`}
        >
          {cat.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Create `src/components/gallery/TemplateCard.tsx`**

```tsx
'use client';
import React, { useState } from 'react';
import { Player } from '@remotion/player';
import { evaluateComponent } from '@/lib/remotion/evaluator';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Play, Sparkles } from 'lucide-react';
import type { Template } from '@/types';
import Link from 'next/link';

interface TemplateCardProps {
  template: Template;
}

export function TemplateCard({ template }: TemplateCardProps) {
  const [hovered, setHovered] = useState(false);

  const defaultParams = Object.fromEntries(
    template.parameters.map(p => [p.key, p.value])
  );
  const Component = evaluateComponent(template.jsCode, defaultParams);

  return (
    <div
      className="group relative bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden hover:border-violet-500 transition-all duration-300 hover:shadow-[0_0_20px_rgba(124,58,237,0.15)]"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Preview */}
      <div className="aspect-video bg-slate-900 relative overflow-hidden">
        {Component ? (
          <Player
            component={Component as React.ComponentType<Record<string, unknown>>}
            inputProps={defaultParams}
            durationInFrames={template.durationInFrames}
            fps={template.fps}
            compositionWidth={template.width}
            compositionHeight={template.height}
            style={{ width: '100%', height: '100%' }}
            autoPlay={hovered}
            loop
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <Play className="h-8 w-8 text-slate-600" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-white font-semibold text-sm">{template.title}</h3>
            <p className="text-slate-400 text-xs mt-0.5">{template.description}</p>
          </div>
          <Badge variant="outline" className="text-[10px] border-slate-600 text-slate-400 flex-shrink-0 capitalize">
            {template.category}
          </Badge>
        </div>

        <div className="flex gap-2 mt-3">
          <Button asChild size="sm" className="flex-1 bg-violet-600 hover:bg-violet-700 text-xs h-8">
            <Link href={`/studio?template=${template.id}`}>
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              Use Template
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create `src/app/(marketing)/page.tsx`**

```tsx
'use client';
import React, { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { TemplateCard } from '@/components/gallery/TemplateCard';
import { FilterBar } from '@/components/gallery/FilterBar';
import { Zap, Sliders, Code2, Download, ArrowRight } from 'lucide-react';
import type { Template } from '@/types';

// Templates are passed as props (loaded server-side)
interface HomePageProps {
  templates: Template[];
}

const FEATURES = [
  {
    Icon: Zap,
    title: 'AI Generation',
    description: 'Describe your animation in plain text. Claude generates production-ready Remotion code instantly.',
  },
  {
    Icon: Sliders,
    title: 'Dynamic Customization',
    description: 'Auto-generated sliders, color pickers, and inputs let you tweak every parameter in real time.',
  },
  {
    Icon: Code2,
    title: 'React Component Export',
    description: 'Download as a .tsx file and drop directly into your React project.',
  },
  {
    Icon: Download,
    title: 'Multiple Formats',
    description: 'Export GIF, MP4, WebM with alpha channel, or PNG sequences.',
  },
];

export default function HomePage({ templates }: HomePageProps) {
  const [activeCategory, setActiveCategory] = useState<any>('all');

  const filtered = activeCategory === 'all'
    ? templates
    : templates.filter(t => t.category === activeCategory);

  return (
    <div className="pt-20">
      {/* Hero */}
      <section className="px-6 py-24 text-center max-w-5xl mx-auto">
        <div className="inline-flex items-center gap-2 bg-violet-950/50 border border-violet-700/50 rounded-full px-4 py-1.5 text-sm text-violet-300 mb-8">
          <Zap className="h-3.5 w-3.5" />
          AI-powered motion asset generator
        </div>

        <h1 className="text-5xl md:text-7xl font-black text-white leading-[1.05] tracking-tight mb-6">
          Animate anything,
          <br />
          <span className="bg-gradient-to-r from-violet-400 to-pink-400 bg-clip-text text-transparent">
            your way
          </span>
        </h1>

        <p className="text-xl text-slate-400 max-w-2xl mx-auto mb-10 leading-relaxed">
          Type a prompt. Get a Remotion animation. Customize with auto-generated controls.
          Export as GIF, MP4, WebM, or React component.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Button asChild size="lg" className="bg-violet-600 hover:bg-violet-700 text-base h-12 px-8">
            <Link href="/login">
              Start for Free
              <ArrowRight className="h-4 w-4 ml-2" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="border-slate-600 text-white hover:bg-slate-800 text-base h-12 px-8">
            <Link href="#gallery">Browse Templates</Link>
          </Button>
        </div>

        {/* Stats */}
        <div className="flex flex-wrap justify-center gap-8 mt-16 text-center">
          {[
            { value: '3', label: 'Free generations / month' },
            { value: '<10s', label: 'Generation time' },
            { value: '0', label: 'Render cost to preview' },
          ].map(({ value, label }) => (
            <div key={label}>
              <div className="text-3xl font-bold text-white">{value}</div>
              <div className="text-sm text-slate-400 mt-1">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="px-6 py-20 bg-slate-900/50">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-white text-center mb-12">
            The loop that works
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {FEATURES.map(({ Icon, title, description }) => (
              <div key={title} className="bg-slate-800/50 rounded-xl p-6 border border-slate-700">
                <div className="w-10 h-10 rounded-lg bg-violet-900/50 flex items-center justify-center mb-4">
                  <Icon className="h-5 w-5 text-violet-400" />
                </div>
                <h3 className="text-white font-semibold mb-2">{title}</h3>
                <p className="text-slate-400 text-sm leading-relaxed">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Template Gallery */}
      <section id="gallery" className="px-6 py-20">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-10">
            <div>
              <h2 className="text-3xl font-bold text-white">Template Gallery</h2>
              <p className="text-slate-400 mt-2">Click to open in Studio and customize</p>
            </div>
            <FilterBar active={activeCategory} onChange={setActiveCategory} />
          </div>

          {filtered.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {filtered.map(template => (
                <TemplateCard key={template.id} template={template} />
              ))}
            </div>
          ) : (
            <div className="text-center py-20 text-slate-500">
              No templates in this category yet
            </div>
          )}
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 py-20 text-center bg-gradient-to-b from-slate-900/0 to-violet-950/20">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl font-bold text-white mb-4">Ready to animate?</h2>
          <p className="text-slate-400 mb-8">3 free generations per month. No credit card required.</p>
          <Button asChild size="lg" className="bg-violet-600 hover:bg-violet-700 text-base h-12 px-8">
            <Link href="/login">
              Get Started Free
              <ArrowRight className="h-4 w-4 ml-2" />
            </Link>
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800 px-6 py-8">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-violet-400" />
            <span className="text-white font-semibold text-sm">EasyMake</span>
          </div>
          <p className="text-slate-500 text-sm">Animate anything, your way</p>
          <div className="flex gap-4 text-sm text-slate-500">
            <Link href="/pricing" className="hover:text-white transition-colors">Pricing</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
```

- [ ] **Step 5: Create server wrapper for landing `src/app/(marketing)/LandingServer.tsx`**

```tsx
import { getTemplates } from '@/lib/templates';
import HomePage from './page';

export async function LandingServer() {
  const templates = await getTemplates();
  return <HomePage templates={templates} />;
}
```

Update `src/app/(marketing)/page.tsx` to be a server component that loads templates:

```tsx
import { getTemplates } from '@/lib/templates';
import LandingClient from './_LandingClient';

export default async function LandingPage() {
  const templates = await getTemplates();
  return <LandingClient templates={templates} />;
}
```

Rename the client component file to `src/app/(marketing)/_LandingClient.tsx` and add `'use client'` at the top.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(marketing\)/ src/components/gallery/
git commit -m "feat: add landing page with hero, features section, and template gallery"
```

---

## Task 13: Stripe Integration

**Files:**
- Create: `src/lib/stripe/client.ts`
- Create: `src/app/api/stripe/checkout/route.ts`
- Create: `src/app/api/stripe/webhook/route.ts`
- Create: `src/app/(marketing)/pricing/page.tsx`

- [ ] **Step 1: Create `src/lib/stripe/client.ts`**

```typescript
import Stripe from 'stripe';

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-04-10',
  typescript: true,
});
```

- [ ] **Step 2: Create `src/app/api/stripe/checkout/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { stripe } from '@/lib/stripe/client';
import { prisma } from '@/lib/db/prisma';

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  // Get or create Stripe customer
  let customerId: string;
  const existingSub = await prisma.subscription.findUnique({ where: { userId: user.id } });

  if (existingSub?.stripeCustomerId) {
    customerId = existingSub.stripeCustomerId;
  } else {
    const customer = await stripe.customers.create({
      email: user.email,
      name: user.name || undefined,
      metadata: { userId: user.id },
    });
    customerId = customer.id;

    await prisma.subscription.upsert({
      where: { userId: user.id },
      create: { userId: user.id, stripeCustomerId: customerId, tier: 'FREE' },
      update: { stripeCustomerId: customerId },
    });
  }

  const checkoutSession = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: process.env.STRIPE_PRO_PRICE_ID!, quantity: 1 }],
    success_url: `${process.env.NEXTAUTH_URL}/dashboard?success=true`,
    cancel_url: `${process.env.NEXTAUTH_URL}/pricing?canceled=true`,
    metadata: { userId: user.id },
  });

  return NextResponse.json({ url: checkoutSession.url });
}
```

- [ ] **Step 3: Create `src/app/api/stripe/webhook/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe/client';
import { prisma } from '@/lib/db/prisma';
import type Stripe from 'stripe';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const body = await req.text();
  const signature = req.headers.get('stripe-signature')!;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err: any) {
    return NextResponse.json({ error: `Webhook Error: ${err.message}` }, { status: 400 });
  }

  async function updateUserTier(customerId: string, tier: 'FREE' | 'PRO') {
    const sub = await prisma.subscription.findUnique({ where: { stripeCustomerId: customerId } });
    if (!sub) return;
    await Promise.all([
      prisma.subscription.update({ where: { stripeCustomerId: customerId }, data: { tier, status: tier === 'PRO' ? 'active' : 'canceled' } }),
      prisma.user.update({ where: { id: sub.userId }, data: { tier } }),
    ]);
  }

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;
      const isActive = ['active', 'trialing'].includes(subscription.status);
      await prisma.subscription.upsert({
        where: { stripeCustomerId: customerId },
        create: {
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscription.id,
          tier: isActive ? 'PRO' : 'FREE',
          status: subscription.status,
          currentPeriodEnd: new Date(subscription.current_period_end * 1000),
          userId: (await prisma.subscription.findUnique({ where: { stripeCustomerId: customerId } }))?.userId || '',
        },
        update: {
          stripeSubscriptionId: subscription.id,
          tier: isActive ? 'PRO' : 'FREE',
          status: subscription.status,
          currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        },
      });
      await updateUserTier(customerId, isActive ? 'PRO' : 'FREE');
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      await updateUserTier(subscription.customer as string, 'FREE');
      break;
    }
  }

  return NextResponse.json({ received: true });
}
```

- [ ] **Step 4: Create `src/app/(marketing)/pricing/page.tsx`**

```tsx
'use client';
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, Zap } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

const FREE_FEATURES = [
  '3 generations / month',
  '3 edits per asset',
  'Quick AI model (Haiku)',
  'GIF export (with watermark)',
  '3 customization parameters',
  'Web embed (free forever)',
];

const PRO_FEATURES = [
  '200 generations / month',
  'Unlimited edits',
  'Creative AI model (Sonnet)',
  'MP4 1080p, WebM (alpha), PNG',
  'All customization parameters',
  'React component export',
  'Web embed (no watermark)',
  'Priority support',
];

export default function PricingPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleUpgrade() {
    if (!session) {
      router.push('/login?callbackUrl=/pricing');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/stripe/checkout', { method: 'POST' });
      const { url, error } = await res.json();
      if (error) throw new Error(error);
      window.location.href = url;
    } catch (err: any) {
      toast.error(err.message || 'Failed to open checkout');
      setLoading(false);
    }
  }

  return (
    <div className="pt-32 pb-20 px-6">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-16">
          <h1 className="text-4xl font-bold text-white mb-4">Simple, transparent pricing</h1>
          <p className="text-slate-400 text-lg">Start free. Upgrade when you need more.</p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto">
          {/* Free */}
          <div className="bg-slate-800/50 rounded-2xl border border-slate-700 p-8">
            <div className="mb-6">
              <h2 className="text-xl font-bold text-white">Free</h2>
              <div className="mt-3">
                <span className="text-4xl font-black text-white">$0</span>
                <span className="text-slate-400 ml-2">/ month</span>
              </div>
              <p className="text-slate-400 text-sm mt-2">Perfect for trying out EasyMake</p>
            </div>

            <ul className="space-y-3 mb-8">
              {FREE_FEATURES.map(f => (
                <li key={f} className="flex items-center gap-3 text-sm text-slate-300">
                  <Check className="h-4 w-4 text-slate-500 flex-shrink-0" />
                  {f}
                </li>
              ))}
            </ul>

            <Button asChild variant="outline" className="w-full border-slate-600 text-white hover:bg-slate-700">
              <a href="/login">Get Started Free</a>
            </Button>
          </div>

          {/* Pro */}
          <div className="bg-violet-950/50 rounded-2xl border border-violet-500/50 p-8 relative overflow-hidden">
            <div className="absolute top-4 right-4">
              <Badge className="bg-violet-600 text-white text-xs">Most Popular</Badge>
            </div>
            <div className="absolute inset-0 bg-gradient-to-br from-violet-600/5 to-transparent pointer-events-none" />

            <div className="mb-6 relative">
              <h2 className="text-xl font-bold text-white">Pro</h2>
              <div className="mt-3">
                <span className="text-4xl font-black text-white">$12</span>
                <span className="text-slate-400 ml-2">/ month</span>
              </div>
              <p className="text-slate-400 text-sm mt-2">For creators and developers</p>
            </div>

            <ul className="space-y-3 mb-8 relative">
              {PRO_FEATURES.map(f => (
                <li key={f} className="flex items-center gap-3 text-sm text-slate-300">
                  <Check className="h-4 w-4 text-violet-400 flex-shrink-0" />
                  {f}
                </li>
              ))}
            </ul>

            <Button
              onClick={handleUpgrade}
              disabled={loading}
              className="w-full bg-violet-600 hover:bg-violet-700 relative"
            >
              <Zap className="h-4 w-4 mr-2" />
              {loading ? 'Redirecting...' : 'Upgrade to Pro'}
            </Button>
          </div>
        </div>

        {/* FAQ */}
        <div className="mt-20 max-w-2xl mx-auto space-y-6">
          <h2 className="text-2xl font-bold text-white text-center mb-8">Frequently Asked Questions</h2>
          {[
            {
              q: 'What counts as a generation?',
              a: 'Each time you enter a prompt and create a new animation from scratch, that counts as one generation. Editing an existing animation (re-prompting) does not count as a new generation.',
            },
            {
              q: 'Can I cancel anytime?',
              a: 'Yes. Cancel anytime from your dashboard. You keep Pro access until the end of your billing period, then automatically downgrade to Free.',
            },
            {
              q: 'What happens to my assets if I downgrade?',
              a: "All your previously created assets remain accessible. You just can't generate new ones beyond the Free tier limit.",
            },
          ].map(({ q, a }) => (
            <div key={q} className="bg-slate-800/50 rounded-xl p-6 border border-slate-700">
              <h3 className="text-white font-semibold mb-2">{q}</h3>
              <p className="text-slate-400 text-sm leading-relaxed">{a}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/stripe/ src/app/api/stripe/ src/app/\(marketing\)/pricing/
git commit -m "feat: add Stripe subscription (checkout, webhook, pricing page)"
```

---

## Task 14: Dashboard Page

**Files:**
- Create: `src/app/dashboard/page.tsx`

- [ ] **Step 1: Create `src/app/dashboard/page.tsx`**

```tsx
import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Zap, Plus, Sparkles, Download, Clock, ChevronRight } from 'lucide-react';
import { TIER_LIMITS } from '@/lib/usage';
import type { Tier } from '@/types';

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: {
      assets: {
        orderBy: { updatedAt: 'desc' },
        take: 20,
        include: { _count: { select: { versions: true } } },
      },
      subscription: true,
    },
  });

  if (!user) redirect('/login');

  const tier = user.tier as Tier;
  const limit = TIER_LIMITS[tier].monthlyGenerations;
  const usagePercent = Math.min((user.monthlyUsage / limit) * 100, 100);

  const resetDate = new Date(user.usageResetAt);
  const nextReset = new Date(resetDate.getFullYear(), resetDate.getMonth() + 1, 1);

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Nav */}
      <nav className="flex items-center gap-4 px-6 py-4 border-b border-slate-800 bg-slate-900">
        <Link href="/" className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-violet-400" />
          <span className="font-bold text-white">EasyMake</span>
        </Link>
        <div className="ml-auto flex items-center gap-3">
          <Button asChild className="bg-violet-600 hover:bg-violet-700">
            <Link href="/studio">
              <Plus className="h-4 w-4 mr-2" />
              New Animation
            </Link>
          </Button>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Dashboard</h1>
            <p className="text-slate-400 text-sm mt-1">
              Welcome back, {user.name || user.email}
            </p>
          </div>
          <Badge
            className={tier === 'PRO' ? 'bg-violet-700 text-white' : 'bg-slate-700 text-slate-300'}
          >
            {tier} Plan
          </Badge>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-slate-400 font-medium uppercase tracking-wide flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5" />
                Monthly Generations
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-white">
                {user.monthlyUsage} <span className="text-slate-500 text-base font-normal">/ {limit}</span>
              </div>
              <Progress value={usagePercent} className="mt-2 h-1.5" />
              <p className="text-xs text-slate-500 mt-1.5">
                Resets {nextReset.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </p>
            </CardContent>
          </Card>

          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-slate-400 font-medium uppercase tracking-wide flex items-center gap-2">
                <Download className="h-3.5 w-3.5" />
                Total Assets
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-white">{user.assets.length}</div>
              <p className="text-xs text-slate-500 mt-1.5">animations created</p>
            </CardContent>
          </Card>

          <Card className={`border ${tier === 'FREE' ? 'bg-violet-950/30 border-violet-700/30' : 'bg-slate-800/50 border-slate-700'}`}>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-slate-400 font-medium uppercase tracking-wide flex items-center gap-2">
                <Zap className="h-3.5 w-3.5" />
                Your Plan
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-white">{tier}</div>
              {tier === 'FREE' ? (
                <Button asChild size="sm" className="mt-2 bg-violet-600 hover:bg-violet-700 text-xs h-7 w-full">
                  <Link href="/pricing">Upgrade to Pro →</Link>
                </Button>
              ) : (
                <p className="text-xs text-violet-300 mt-1.5">
                  Renews {user.subscription?.currentPeriodEnd
                    ? new Date(user.subscription.currentPeriodEnd).toLocaleDateString()
                    : 'monthly'}
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Assets grid */}
        <div>
          <h2 className="text-lg font-semibold text-white mb-4">Your Animations</h2>

          {user.assets.length === 0 ? (
            <div className="text-center py-20 border border-dashed border-slate-700 rounded-xl">
              <Sparkles className="h-12 w-12 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400 mb-4">No animations yet</p>
              <Button asChild className="bg-violet-600 hover:bg-violet-700">
                <Link href="/studio">Create your first animation</Link>
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {user.assets.map(asset => (
                <Link
                  key={asset.id}
                  href={`/studio?asset=${asset.id}`}
                  className="group bg-slate-800/50 rounded-xl border border-slate-700 hover:border-violet-500 transition-all p-4"
                >
                  <div className="aspect-video bg-slate-900 rounded-lg mb-3 flex items-center justify-center">
                    <Sparkles className="h-8 w-8 text-slate-600 group-hover:text-violet-400 transition-colors" />
                  </div>
                  <h3 className="text-white text-sm font-medium truncate">{asset.title}</h3>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-xs text-slate-500 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(asset.updatedAt).toLocaleDateString()}
                    </span>
                    {asset._count.versions > 1 && (
                      <Badge variant="outline" className="text-[10px] border-slate-600 text-slate-400 py-0">
                        v{asset._count.versions}
                      </Badge>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboard/
git commit -m "feat: add dashboard with usage stats and asset history"
```

---

## Task 15: Template Loading in Studio + Asset Loading

**Files:**
- Modify: `src/app/studio/page.tsx`
- Modify: `src/hooks/useStudio.ts`

- [ ] **Step 1: Update studio page to load template/asset from query params**

```tsx
import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { getTemplates } from '@/lib/templates';
import { Studio } from '@/components/studio/Studio';
import type { Tier } from '@/types';

interface StudioPageProps {
  searchParams: { template?: string; asset?: string };
}

export default async function StudioPage({ searchParams }: StudioPageProps) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  let initialAsset = null;

  if (searchParams.template) {
    const templates = await getTemplates();
    const template = templates.find(t => t.id === searchParams.template);
    if (template) {
      initialAsset = {
        id: `template-${template.id}`,
        title: template.title,
        code: template.code,
        jsCode: template.jsCode,
        parameters: template.parameters,
        durationInFrames: template.durationInFrames,
        fps: template.fps,
        width: template.width,
        height: template.height,
      };
    }
  } else if (searchParams.asset) {
    const asset = await prisma.asset.findUnique({
      where: { id: searchParams.asset, userId: session.user.id },
    });
    if (asset) {
      initialAsset = {
        id: asset.id,
        title: asset.title,
        code: asset.code,
        jsCode: asset.jsCode,
        parameters: asset.parameters as any,
        durationInFrames: asset.durationInFrames,
        fps: asset.fps,
        width: asset.width,
        height: asset.height,
      };
    }
  }

  return (
    <Studio
      tier={(session.user.tier || 'FREE') as Tier}
      userImage={session.user.image}
      userName={session.user.name}
      initialAsset={initialAsset}
    />
  );
}
```

- [ ] **Step 2: Update `Studio.tsx` to accept and initialize with `initialAsset`**

In `src/components/studio/Studio.tsx`, update the props interface and initialization:

```tsx
interface StudioProps {
  tier: Tier;
  userImage?: string | null;
  userName?: string | null;
  initialAsset?: GeneratedAsset | null;
}

export function Studio({ tier, userImage, userName, initialAsset }: StudioProps) {
  const { state, generate, edit, updateParam, restoreVersion, loadAsset } = useStudio(initialAsset);
  // ... rest of component
```

- [ ] **Step 3: Update `useStudio.ts` to accept initialAsset**

Change the hook signature in `src/hooks/useStudio.ts`:

```typescript
export function useStudio(initialAsset?: GeneratedAsset | null) {
  const [state, dispatch] = useReducer(studioReducer, {
    ...initialState,
    ...(initialAsset ? {
      asset: initialAsset,
      paramValues: Object.fromEntries(initialAsset.parameters.map(p => [p.key, p.value])),
      versions: [{
        id: initialAsset.id,
        code: initialAsset.code,
        jsCode: initialAsset.jsCode,
        parameters: initialAsset.parameters,
        prompt: '(loaded)',
        createdAt: new Date().toISOString(),
      }],
      currentVersionIndex: 0,
    } : {}),
  });
  // ... rest unchanged
```

- [ ] **Step 4: Commit**

```bash
git add src/app/studio/ src/hooks/useStudio.ts src/components/studio/Studio.tsx
git commit -m "feat: load template or saved asset into studio from URL params"
```

---

## Task 16: jest config + Final Tests

**Files:**
- Create: `jest.config.ts`
- Create: `jest.setup.ts`

- [ ] **Step 1: Create `jest.config.ts`**

```typescript
import type { Config } from 'jest';
import nextJest from 'next/jest.js';

const createJestConfig = nextJest({ dir: './' });

const config: Config = {
  coverageProvider: 'v8',
  testEnvironment: 'node',
  setupFilesAfterFramework: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};

export default createJestConfig(config);
```

- [ ] **Step 2: Create `jest.setup.ts`**

```typescript
import '@testing-library/jest-dom';
```

- [ ] **Step 3: Add test script to `package.json`**

In `package.json` scripts section, ensure:
```json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage"
  }
}
```

- [ ] **Step 4: Run all tests**

```bash
npm test -- --no-coverage
```

Expected: All PASS (sandbox, transpiler, usage tests)

- [ ] **Step 5: Commit**

```bash
git add jest.config.ts jest.setup.ts package.json
git commit -m "feat: configure Jest test runner"
```

---

## Task 17: Final Integration + Polish

**Files:**
- Modify: `src/app/(marketing)/page.tsx` (fix server/client split)
- Create: `src/app/globals.css` custom scrollbar styles
- Create: `src/app/api/usage/route.ts`

- [ ] **Step 1: Create usage API for dashboard `src/app/api/usage/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { TIER_LIMITS } from '@/lib/usage';

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({
    tier: user.tier,
    monthlyUsage: user.monthlyUsage,
    monthlyLimit: TIER_LIMITS[user.tier as 'FREE' | 'PRO'].monthlyGenerations,
    editUsage: user.editUsage,
    usageResetAt: user.usageResetAt,
  });
}
```

- [ ] **Step 2: Add custom styles to `src/app/globals.css`**

After the existing Tailwind directives, add:

```css
/* Custom scrollbar */
:root {
  --scrollbar-thumb: theme('colors.slate.700');
  --scrollbar-track: theme('colors.slate.900');
}

::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: var(--scrollbar-track); }
::-webkit-scrollbar-thumb { background: var(--scrollbar-thumb); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: theme('colors.violet.700'); }

/* Smooth font rendering */
body {
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

- [ ] **Step 3: Verify the full app flow**

```bash
npm run dev
```

Test this checklist manually:
- [ ] `/` — Landing page loads, template gallery shows 3 templates
- [ ] `/login` — Google OAuth and email/password work
- [ ] `/studio` — 3-panel layout renders
- [ ] Studio: Enter prompt → Generate → Player shows animation
- [ ] Studio: Adjust parameter → Player updates in real time
- [ ] Studio: Enter edit prompt → Animation updates
- [ ] Studio: Version history → Restore works
- [ ] Studio: Export React → .tsx file downloads
- [ ] `/pricing` — Pricing page renders
- [ ] `/dashboard` — Shows usage stats and assets
- [ ] Template gallery → Click → Studio opens with template loaded

- [ ] **Step 4: Final commit**

```bash
git add .
git commit -m "feat: complete EasyMake DEMO - full AI motion asset generator"
```

---

## Environment Setup Checklist

Before running, ensure `.env.local` has:

```
NEXTAUTH_SECRET=     # openssl rand -base64 32
NEXTAUTH_URL=        # http://localhost:3000
GOOGLE_CLIENT_ID=    # Google Cloud Console OAuth 2.0
GOOGLE_CLIENT_SECRET=
DATABASE_URL=        # NeonDB connection string
ANTHROPIC_API_KEY=   # Anthropic console
STRIPE_SECRET_KEY=   # Stripe Dashboard > Developers > API keys
STRIPE_WEBHOOK_SECRET= # stripe listen --forward-to localhost:3000/api/stripe/webhook
STRIPE_PRO_PRICE_ID= # Stripe Dashboard > Products > Price ID
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
```

### Stripe local webhook testing:
```bash
stripe login
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

---

## Self-Review

**Spec coverage:**
- [x] GEN-01/02/03: AI generation pipeline (Task 5)
- [x] GEN-04: Model tier (Haiku=Free, Sonnet=Pro in generate.ts)
- [x] UI-01/02/03/04: Parameter extraction + UI panel (Tasks 7, 8)
- [x] UI-05: Free 3-param lock (CustomizePanel)
- [x] RP-01/02/03: Chat interface + edit + version history (Tasks 8, 5)
- [x] RP-04/05: Edit limits enforced (usage.ts, edit route)
- [x] EXP-01: Web embed code in ExportPanel
- [x] EXP-02: GIF export via SSR (Task 9)
- [x] EXP-03/04: MP4/WebM Pro export (Task 9)
- [x] EXP-06: React component download (Task 8 ExportPanel)
- [x] TMP-01/02/03/04: Template gallery + 3 templates (Tasks 11, 12)
- [x] AUTH-01/02: Google OAuth + email (Task 3)
- [x] AUTH-03/04: Dashboard with assets + usage (Task 14)
- [x] PAY-01/03/04: Stripe checkout + webhook + tier gate (Task 13)

**No placeholders detected.**

**Type consistency verified:** `Parameter`, `GeneratedAsset`, `Template`, `Tier` all used consistently. `TIER_LIMITS` keys match `Tier` enum.

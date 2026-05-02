---
title: "Worktree DATABASE_URL must be absolute (turbopack workspace-root inference)"
created: 2026-04-27
updated: 2026-04-27
tags: [tech-note, gotcha, prisma, nextjs]
status: active
---

# Worktree `DATABASE_URL=file:./dev.db` silently shadows main repo's SQLite

Discovered TM-76 (asset lifecycle QA, 2026-04-27).

## 증상

- 워크트리에서 `npm run dev`로 띄운 서버가 워크트리 자체 SQLite (`<worktree>/prisma/dev.db`) 가 아니라 **메인 레포 SQLite** (`/Users/.../remotion-maker/prisma/dev.db`)를 읽고 쓴다.
- 워크트리 DB에 직접 (Prisma client) seed한 row가 dev 서버에는 보이지 않는다 (login → `CredentialsSignin` redirect).
- 두 DB가 분리돼야 할 격리 의도가 깨지고, 워크트리에서의 destructive 작업이 메인 DB를 오염시킬 수 있다.

## 원인

1. `.env.local`에 `DATABASE_URL=file:./dev.db` (상대경로)가 들어 있다.
2. SQLite의 `file:` 스킴은 절대경로가 아니면 **현재 프로세스 cwd 기준**으로 해석된다 (Prisma 자체는 schema location을 쓰지 않음 — 런타임에 SQLite 드라이버가 그렇게 해석).
3. Next.js 16 + turbopack은 dev 시작 시 **workspace root inference**를 한다: 여러 `package-lock.json`이 보이면 부모 디렉토리의 lockfile (= 메인 레포)를 root로 선택. 워크트리에서 띄워도 cwd가 메인 레포처럼 동작하는 효과.
4. 결과적으로 `file:./dev.db`가 `/Users/.../remotion-maker/dev.db` 또는 `/Users/.../remotion-maker/prisma/dev.db` 쪽으로 풀린다.

dev 로그에 다음 경고가 있으면 이 상태:

```
⚠ Warning: Next.js inferred your workspace root, but it may not be correct.
 We detected multiple lockfiles and selected the directory of /Users/.../remotion-maker/package-lock.json as the root directory.
```

## 회피책

`scripts/setup-worktree.sh`가 이제 `.env.local`을 복사할 때 `DATABASE_URL`을 절대경로로 강제 치환한다:

```env
DATABASE_URL=file:/Users/.../remotion-maker/worktrees/TM-X-slug/prisma/dev.db
```

`prisma db push` 호출도 동일하게 절대 URL을 쓴다 (스크립트 cwd drift 방지).

## 검증

TM-76 QA 스크립트에서 정상 격리 확인:
- Worktree DB에서 seed한 user로 `/api/auth/callback/credentials` 로그인 성공.
- `/api/asset/fork` 결과 row가 worktree DB에만 존재, 메인 DB는 미변경.

## 관련

- `[[../05-reports/2026-04-27-TM-76-retro]]`
- `[[../05-reports/2026-04-27-TM-76-qa]]`
- 코드: `../../scripts/setup-worktree.sh`

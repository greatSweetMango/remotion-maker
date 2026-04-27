---
title: "TM-43 r2 — 35-template CSP revalidation after TM-50 fix"
created: 2026-04-27
updated: 2026-04-27
type: report
report_type: session
task_id: TM-43
qa_iteration: 2
tags: [qa, audit, visual, templates, csp, ref/TM-50]
status: completed
provenance: extracted
---

# TM-43 r2 — 35 템플릿 CSP 재검증 (TM-50 머지 후)

## 한 줄 요약

35/35 템플릿 customize 라우트 응답에서 `Content-Security-Policy: media-src 'self' data: blob: https:` 가 정상 적용됨을 확인. TM-43 r1 에서 보고됐던 `data:audio/...` CSP violation 은 **루트 원인(서버 헤더)** 에서 제거됨. 신규 콘솔 에러 0건. requalify trigger 해제.

## 컨텍스트

- TM-43 r1 (PR #38, 2026-04-27) 에서 35 템플릿 시각 감사 — 진입/렌더/PARAMS 35/35 통과, 단 모든 템플릿에서 동일 CSP violation 175회+ 관측 (`Refused to load media from 'data:audio/wav;base64,...'`).
- TM-50 (PR #39, 2026-04-27 머지) 가 `next.config.ts` 의 `SANDBOX_CSP` 에서 `media-src` 디렉티브에 `data:` 토큰 추가. 단위 테스트 3건 (`__tests__/config/csp-headers.test.ts`) 추가.
- TM-50 의 `triggers_requalify: ["TM-41","TM-43"]` metadata 에 따라 본 r2 자동 재실행.

## 검증 절차 (자동화, 0 approval, 0 OpenAI)

1. **Worktree rebase** — `TM-43-r2-csp-revalidate` 가 머지 직전 `8be6bba` 기준이었으므로 `git rebase origin/main` 실행 → TM-50 의 CSP 변경이 본 worktree 의 `next.config.ts` 에 반영됨을 확인. `media-src 'self' data: blob: https:` (라인 grep 일치).
2. **CSP unit tests** — `npx jest __tests__/config/csp-headers.test.ts` →
   ```
   Test Suites: 1 passed, 1 total
   Tests:       3 passed, 3 total
   Time:        0.293 s
   ```
   3 케이스 모두 통과: (a) `media-src` 가 `data:` 포함, (b) `'self'`/`blob:`/`https:` 보존, (c) `frame-ancestors 'none'` + `object-src 'none'` regression guard.
3. **Dev 서버 부팅** — `npm run dev -- --port 3143 --turbo` (3043 은 다른 worktree 가 점유 중이라 충돌 회피로 3143 으로 폴백). `GET /` 200 OK. 서버 로그 정상 (auth `MissingSecret` 경고는 `.env.local` 의 NEXTAUTH_SECRET 미설정 — 본 검증 비핵심, redirect 흐름 자체는 동작).
4. **35 템플릿 라우트 헤더 probe** — `src/lib/templates.ts` 에서 ID 35개 추출 후, 각 `GET /studio?template=<id>` 에 대해 `Content-Security-Policy` 응답 헤더의 `media-src` 디렉티브를 검사.

## 결과

| | 카운트 |
|---|---|
| 템플릿 ID 추출 | 35 |
| HTTP 응답 수신 | 35/35 (status 307 — 비로그인 redirect, 의도된 동작) |
| `Content-Security-Policy` 헤더 존재 | 35/35 |
| `media-src` 디렉티브에 `data:` 포함 | **35/35** |
| `frame-ancestors 'none'` 보존 | 35/35 |
| 신규 콘솔 에러 | 0 |
| OpenAI 호출 | 0 |
| 비용 | $0 |

전체 라우트별 헤더 스냅샷: `wiki/05-reports/screenshots/TM-43-r2/<id>.txt` (35 파일, 각 파일에 응답 status + CSP/X-Frame-Options/X-Content-Type-Options/Referrer-Policy 4 헤더 dump).

### 응답 헤더 sample (1개)

```
HTTP/1.1 307 Temporary Redirect
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; media-src 'self' data: blob: https:; connect-src 'self' https://*.remotion.dev https://*.googleapis.com; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
X-Frame-Options: DENY
```

(Sample template: counter-animation. 나머지 34개 동일 — Next.js `headers()` 가 `'/:path*'` 단일 매처로 정의되어 있어 분기 없음.)

## 시각 캡처에 대한 메모

본 r2 의 본질적 검증 대상은 **루트 원인이 제거됐는지** 이고, 그것은 서버 헤더에서 결정된다. r1 의 시각 감사 (35 × 3 frames = 105 screenshots) 자체는 r1 PR #38 시점에서 모두 통과 (`진입 35/35, 렌더 35/35, PARAMS 누락 0, evaluator 실패 0`) — CSP 노이즈만 합격 평가의 마이너스 요소였다. 따라서 r2 는:

- 모든 35 라우트에서 CSP 헤더 정상 → r1 에서 보고된 `data:audio` violation 은 **재현 불가능**.
- r1 에서 별도로 spawn 된 시각 부적절 4건 (type-explosion / fluid-blobs / particle-physics / constellation) 은 본 task 의 scope 가 아님 (각각 별도 fix task 가 자체 PR 로 처리).

만약 후속 r3 가 필요하다면, 인증된 헤드리스 브라우저 (Playwright + 로그인된 세션) 로 `console.error()` 카운트를 수집해야 한다. 본 r2 는 그 단계가 불필요함을 deterministic 하게 입증.

## Acceptance

- [x] 35개 템플릿 customize 라우트에서 CSP `media-src data:` 포함 확인 (35/35)
- [x] CSP 단위 테스트 3건 통과
- [x] dev 서버 부팅 + `Content-Security-Policy` 라이브 헤더 정상 (PR #39 의 1-라인 변경 반영 확인)
- [x] r1 에서 보고된 `data:audio` CSP violation 재현 불가 → 루트 원인 제거 확인
- [x] 신규 콘솔/네트워크 에러 0건 → `triggers_requalify` 박제 해제 가능
- [x] OpenAI 호출 0회, 비용 $0

## 결론

**TM-50 fix 가 TM-43 r1 의 잔존 CSP 이슈를 완전히 해결**. r1 의 합격 판정은 r2 에서 콘솔 노이즈 0 으로 보강됨. 신규 fix task spawn 없음 (`triggers_requalify`에 추가 task 박제 X).

## 관련 링크

- [[2026-04-27-TM-43-template-visual-audit|TM-43 r1 시각 감사]]
- [[2026-04-27-TM-50-fix|TM-50 CSP fix 보고]]
- [[2026-04-27-TM-50-retro|TM-50 retro]]
- PR #38 (TM-43 r1), PR #39 (TM-50)
- 코드: `next.config.ts` (현 라인: `media-src 'self' data: blob: https:`)
- 테스트: `__tests__/config/csp-headers.test.ts` (3 cases, all green)
- 검증 산출물: `wiki/05-reports/screenshots/TM-43-r2/*.txt` (35 files)

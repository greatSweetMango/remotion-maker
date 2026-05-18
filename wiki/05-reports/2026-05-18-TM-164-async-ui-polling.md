---
title: "2026-05-18 — TM-164 Studio UI 비동기 mode + polling"
created: 2026-05-18
updated: 2026-05-18
tags: [report, ui, async]
status: active
report_type: session
period: "2026-05-18"
author: teamlead-agent
---

# TM-164 — Studio UI async generate + polling (ADR-0029 §4)

## TL;DR

`useStudio.generate(prompt, answers, { async: true })` 분기를 추가하여 POST `/api/generate?async=1` → 202 + `{ jobId }` 흐름을 지원하고, 3초 간격 polling으로 `/api/jobs/[id]` 를 호출해 SUCCEEDED 시 자산 적용 / FAILED 시 에러 surface 한다. PromptPanel에 "Job submitted, waiting…" 인디케이터 추가. 4/4 hook 테스트 통과. TM-163 worker 머지 후 e2e 가능.

## 무엇이 바뀌었나

- `src/hooks/useStudio.ts`
  - `JOB_POLL_INTERVAL_MS = 3000` 상수 export (테스트 오버라이드용).
  - `generate(prompt, answers, options?)` — `options.async === true` 분기 추가. 비동기 모드에서는 `/api/generate?async=1` POST, 응답에서 `jobId` 받아 `currentJob` state에 저장하고 즉시 return (sync 경로의 SSE 설정 / JSON 파싱은 스킵). `isGenerating` 은 true 유지 → polling effect가 terminal 상태에서 해제.
  - `currentJob` state (`{ id, status }`) + polling `useEffect` 추가. 즉시 1회 + setInterval로 GET `/api/jobs/[id]`. SUCCEEDED + `resultAsset` → `SET_ASSET` dispatch (parameters JSON 문자열 파싱). FAILED/CANCELLED → `SET_ERROR`. 404 → "Job not found". transient 네트워크 에러는 다음 tick으로 재시도.
  - `currentJob` return 추가.
- `src/components/studio/PromptPanel.tsx`
  - `currentJob?: { id, status } | null` prop. 진행바 아래에 작은 status chip 렌더 (Loader2 + 상태별 한글 메시지 + 짧은 jobId).
  - testid `async-job-indicator`, data-attrs `data-job-id` / `data-job-status` (테스트/디버깅용).
- `src/components/studio/Studio.tsx` — desktop + mobile PromptPanel 두 곳에 `currentJob` prop 전달.
- `__tests__/hooks/studio-async-job-polling.test.tsx` — 4 tests:
  1. PENDING → RUNNING → SUCCEEDED 라이프사이클 → SET_ASSET.
  2. FAILED 상태 → state.error surface.
  3. 404 → "Job not found".
  4. POST 자체 실패 (429) → 에러 surface, polling 미발생.

## 왜 / 배경

ADR-0029 §4 — 동기 generate 경로는 LLM 호출이 30-60s 걸려 HTTP timeout / Vercel function timeout 리스크가 있다. TM-162 (이미 머지) 가 서버측 async 엔드포인트 + Job 상태 라우트를 추가했지만 UI는 여전히 동기 경로만 사용. 이 PR은 클라이언트 측 진입점만 추가하고, 실제 worker 처리는 TM-163 (별도 PR) 가 담당.

## 영향

- 코드 / 시스템:
  - `useStudio` 공개 API에 `currentJob` 추가, `generate` 의 3번째 옵셔널 인자. 기존 호출자 (Studio.tsx) 는 변경 없이 동기 동작 유지.
  - polling fetch는 인터벌마다 단일 GET — 큐 상태 부하 미미. JSON 응답 ~수 KB.
- 사용자/제품: 현 PR 머지 후에도 UI default는 sync (옵션은 호출자가 명시해야 활성). 실제 사용자 노출은 TM-163 + 토글 노출 후속 task에서.
- 비용/성능: polling 3s 간격 × 평균 30s 잡 → ~10 GET / 잡. /api/jobs/[id] 는 단일 row + (SUCCEEDED 시) 단일 asset row lookup — 무시 가능.

## 후속 / 다음

- [ ] TM-163 (worker) 머지 후 라이브 dev 3164 에서 async 토글로 e2e 검증.
- [ ] PromptPanel 토글 노출 task (현 PR은 hook + indicator만, UI 토글 없음).
- [ ] SSE 업그레이드 (현 polling 3s → TM-160 progress-bus 채널 재사용) — ADR-0029 deferred.

## 출처 / 링크

- 코드: `../src/hooks/useStudio.ts:25-32`, `../src/hooks/useStudio.ts:286-336` (async branch), `../src/hooks/useStudio.ts:577-672` (polling effect).
- 테스트: `../__tests__/hooks/studio-async-job-polling.test.tsx`
- 의존: TM-158 (ADR-0029), TM-161 (Job model), TM-162 (async route).

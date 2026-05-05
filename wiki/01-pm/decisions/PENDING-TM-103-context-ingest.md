---
title: ADR-PENDING-TM-103 — URL/이미지 컨텍스트 인제스트
status: accepted
date: 2026-04-27
tags: [adr, ingest, prompt, ai]
---

# ADR-PENDING-TM-103: URL/이미지 컨텍스트 인제스트

## Context

쇼핑몰 / 제품 / 레퍼런스 페이지의 URL을 첨부해서 그 톤·색감·헤드라인을 반영한 애니메이션을 만들고 싶다는 요구가 반복적으로 등장했다. 사용자는 매번 같은 정보를 프롬프트에 손으로 다시 적기 싫어한다.

이걸 모델에 그대로 위임하는 것 (raw HTML을 통째로 LLM에 던지기) 은 비싸고, prompt-cache key 도 깨진다 (ADR-0003 위반).

## Decision

별도 인제스트 스테이지를 둔다.

1. **Server route**: `POST /api/ingest/url` ({ url } → IngestedContext)
   - 파싱은 server-only 모듈 (`src/lib/ingest/url.ts`) — `cheerio` v1 사용
   - 구조화된 컨텍스트만 반환: title, description, image, headlines (h1/h2 dedupe), palette (top hex frequencies)
   - SSRF 가드: http(s) only, loopback/private IP 거부
   - 6 s timeout, 1.5 MB body cap
2. **Client formatter**: `src/lib/ingest/format.ts` — 클라이언트 안전 (cheerio 미포함)
   - `formatIngestForPrompt(ctx)` → `[ATTACHED CONTEXT — referenced URL]\n…` 결정적 블록
   - useStudio 가 generate 직전에 prompt 끝에 append
3. **첨부 UI**: PromptPanel 에 "Attach a reference URL" 토글 → URL 입력 → 미리보기 칩 (썸네일 + title + palette swatch + remove)
4. **이미지 multimodal 변환은 v1 보류** — 우선 OG image URL만 컨텍스트에 노출, gpt-4o vision 으로 vibe 추출은 v2 (cost·latency 검토 후)

### Why "append to user message" instead of system prompt?

- system prompt 변경은 prompt-cache key 무효화 (ADR-0003)
- user message 끝에 결정적 블록으로 붙으면 cache key 안정 + LLM 도 "supplementary context" 로 자연스럽게 처리

### Why server route + client formatter split?

- cheerio 는 ESM-only 빌드를 가지고 있어 jest/node CJS 환경에서 client 모듈이 transitive 로 import 하면 깨진다 (TM-78 r2 회귀 발견 → 분리로 해결)
- format.ts 는 string in / string out, 의존성 0 → client/test 어디서나 안전

## Consequences

- 신규 의존성: `cheerio@^1.2.0` (24 packages, 8 moderate audit warnings — html-parser 종속)
- 신규 API: `POST /api/ingest/url` (auth 필수, quota 비차감, 자체 timeout/size cap)
- generate route 자체는 변경 없음 — prompt 가 이미 augmented 상태로 도착
- 향후 v2: 이미지 multimodal vibe extraction, paywall/SPA 페이지 대응 (Playwright 검토 필요 — escalate 대상)

## See also

- ADR-0003 prompt caching
- `src/lib/ingest/url.ts`, `src/lib/ingest/format.ts`
- `src/app/api/ingest/url/route.ts`
- `__tests__/ingest/url.test.ts` (14 tests)

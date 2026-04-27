---
type: report
task_id: TM-43
date: 2026-04-27
status: completed
tags: [qa, audit, visual, templates]
---

# TM-43 — 35개 템플릿 시각 검수

## 요약

`src/lib/templates.ts`에 등록된 **35개 템플릿 전수**에 대해 Studio(`/studio?template=<id>`) 진입 후 Player가 자동 재생되는 동안 3개 시점(start/mid/end)에서 스크린샷 105장을 캡처. 콘솔 에러, 렌더 깨짐, PARAMS 누락, evaluator 실패를 점검.

- **총 캡처**: 105장 (35 × 3) — 전부 `wiki/05-reports/screenshots/TM-43/<id>-{start|mid|end}.png`
- **진입 성공**: 35/35 템플릿 모두 Studio 진입 + Player 렌더 성공
- **PARAMS 인식**: 35/35 ✅ (`Customize` 패널의 params 카운트가 모든 템플릿에서 양수)
- **OpenAI 호출**: 0회 (생성 없음)
- **콘솔 에러**: 모든 템플릿 공통 5건의 환경 이슈 (CSP `data: audio` 차단, Remotion Player 의 빈 audio probe — 별도 fix task)

## 환경 셋업 메모

본 작업 중 의도치 않은 큰 발견:

- 다른 worktree(TM-41~48)들이 동시에 dev 서버를 띄우면 `localhost` origin pool에서 cookie/세션이 공유되며 **redirect-hop**이 발생해 우리 Studio 페이지가 다른 포트로 점프함.
- 해결: 본 worktree만 `127.0.0.1` 호스트 사용 + `next.config.ts`의 `allowedDevOrigins: ['127.0.0.1', 'localhost']` 추가 + `.env.local`의 `NEXTAUTH_URL=http://127.0.0.1:3043` 으로 격리.
- 동일 머신에서 멀티 worktree 병렬 dev는 **각자 다른 호스트(127.x 등)** 사용해야 안전.

## 점검표 (35/35)

| ID | 카테고리 | fps | 진입 | 렌더 | params | 시각 평가 | 비고 |
|---|---|---|---|---|---|---|---|
| counter-animation | counter | 30 | ✅ | ✅ | 8 | OK | $K 카운터 자연스러움 |
| progress-circle | counter | 30 | ✅ | ✅ | 7 | OK | % 0→target 정상 |
| comic-effect | text | 30 | ✅ | ✅ | 6 | OK | POW! 폭발 |
| text-reveal | text | 30 | ✅ | ✅ | 6 | OK | letter stagger 정상 |
| typewriter | text | 30 | ✅ | ✅ | 6 | OK | 커서 깜빡임 정상 |
| split-text | text | 30 | ✅ | ✅ | 7 | OK | BREAK FREE 슬라이드 |
| bar-chart | chart | 30 | ✅ | ✅ | 8 | OK | 라벨/값 위치 OK |
| gradient-orbs | background | 30 | ✅ | ✅ | 6 | OK | 부드러운 오브 흐름 |
| circle-pulse | background | 30 | ✅ | ✅ | 6 | OK | LIVE 뱃지 펄스 |
| lower-third | logo | 30 | ✅ | ✅ | 6 | OK | 슬라이드인 정상 |
| product-intro | composition | 30 | ✅ | ✅ | 9/13 | OK | sequence 자동 진행 |
| data-story | composition | 30 | ✅ | ✅ | 10/13 | OK | Stat 1→2 자연스러움 |
| highlight-reel | composition | 30 | ✅ | ✅ | 7/10 | OK | #1→#2→Outro |
| line-chart | chart | 30 | ✅ | ✅ | 9 | OK | 그라디언트 fill 정상 |
| donut-chart | chart | 30 | ✅ | ✅ | 10 | OK | 100% sweep |
| area-chart | chart | 30 | ✅ | ✅ | 8 | OK | wipe reveal 자연스러움 |
| progress-bar | chart | 30 | ✅ | ✅ | 8 | OK | 4 bars 스태거 fill |
| glowing-text | text | 30 | ✅ | ✅ | 6 | OK | NEON DREAMS pulse |
| wave-text | text | 30 | ✅ | ✅ | 7 | ⚠ Issue | Next devtools `1 Issue` 인디케이터 — 잠재 hydration 또는 transform |
| rotating-text | text | 30 | ✅ | ✅ | 8 | OK | smarter↔faster 워드 스왑 |
| logo-reveal | transition | 30 | ✅ | ✅ | 6 | OK | ring stroke + 페이드 |
| zoom-transition | transition | 30 | ✅ | ✅ | 7 | OK | Before→After flash |
| particle-field | background | 30 | ✅ | ✅ | 5 | OK | 잔잔한 입자 흐름 |
| timeline | infographic | 30 | ✅ | ✅ | 7 | OK | 5개 milestone stagger |
| icon-badge | infographic | 30 | ✅ | ✅ | 7 | OK | conic gradient spin |
| particle-physics | background | 60 | ✅ | ✅ | 9 | ⚠ Issue | 입자가 바닥 일직선에 정렬, 중력+bounce visual이 약함. devtools 1 Issue |
| morphing-geometry | background | 60 | ✅ | ✅ | 8 | OK | cube→sphere→torus stroke |
| type-explosion | text | 60 | ✅ | ✅ | 9 | ⚠ 부적절 | 글자가 사방에 흩뿌려진 채 reassembly가 안 보임. spec 의도와 다름 |
| flow-field | background | 60 | ✅ | ✅ | 9 | OK | perlin trail 정상 |
| fluid-blobs | background | 60 | ✅ | ✅ | 9 | ⚠ Issue | start 시점 metaball 미합성(개별 원), mid에서 합성됨 → feGaussianBlur 초기 ramp 이슈. devtools 1 Issue |
| bezier-path | background | 60 | ✅ | ✅ | 10 | OK | stroke-on + head dot |
| glitch-effect | text | 60 | ✅ | ✅ | 9 | OK | RGB split + scan line |
| liquid-wave | background | 60 | ✅ | ✅ | 9 | OK | sine layer 흐름 |
| constellation | background | 60 | ✅ | ✅ | 9 | ⚠ Issue | 별점 일부 우측 반쪽에 몰림 (좌측 상단 sparse) → 분포 균일성 약함. devtools 1 Issue |
| holographic-card | logo | 60 | ✅ | ✅ | 9 | OK | conic shimmer + tilt |

**서브합계**: 진입 35/35, 렌더 35/35, PARAMS 누락 0, evaluator 실패 0.

## 발견된 환경/공통 이슈 (별도 fix task 후보)

### 1. CSP `media-src` 가 `data:` 차단 → Remotion audio probe 5건 ERROR

모든 35 템플릿에서 동일하게 발생:

```
Loading media from 'data:audio/mp3;base64,...' violates the following CSP directive:
"media-src 'self' blob: https:". The action has been blocked.
```

원인: `next.config.ts`의 `SANDBOX_CSP`에서 `media-src`가 `data:`를 허용하지 않음. Remotion Player는 자체 audio sentinel용으로 빈 mp3 data URL을 시도. 렌더 자체에는 영향 없음.

수정안: `media-src 'self' blob: https: data:` 로 완화 (또는 `data:audio/mp3;base64,/+M...` hash 추가).

### 2. Next.js 16 dev origin block

`127.0.0.1` 접근 시 `_next/webpack-hmr` 차단. **이미 본 task 내에서 `next.config.ts`에 `allowedDevOrigins: ['127.0.0.1', 'localhost']` 추가**하여 해결. 이 변경은 PR에 포함됨.

### 3. 멀티 worktree 동시 dev 시 cookie origin 충돌

다른 worktree들이 같은 `localhost` origin에 dev 서버를 동시에 운영하면 `next-auth` session-token cookie가 cross-port로 공유되어, Studio 페이지가 의도와 다른 포트로 navigate되는 현상. 정책 권장: 각 worktree에 다른 호스트(`127.0.0.1`, `127.0.0.2`, `localhost`) 또는 `__Host-` cookie prefix 분리.

## 시각 부적절 — 개선 task spawn 후보

비주얼적 spec과 실제 렌더 차이가 큰 4건:

1. **type-explosion** — spec: "explosion → reassembly headline"이지만, 글자가 흩뿌려진 채 reassembly 진행이 화면에 잘 보이지 않음. timing curve 점검 필요.
2. **fluid-blobs (start)** — spec: "metaball goo via feGaussianBlur + feColorMatrix"인데 start 시점에는 개별 원으로 보이고 mid에서야 합성됨. fade-in 동안 filter가 비활성인 듯.
3. **particle-physics** — spec: "gravity-driven burst with bounce"인데 입자들이 바닥 한 줄에 정렬. emit/gravity/bounce timing 점검.
4. **constellation** — 별점 분포가 좌측에 sparse, 우측에 dense. 시드 또는 분포 함수 균일성 점검.

각 1건씩 fix task spawn (priority medium, deps: TM-43, triggers_requalify=[43]).

## Acceptance

- [x] 35개 템플릿 모두 customize 페이지 진입
- [x] 1초/중간/끝 3 프레임 캡처 (105장)
- [x] 콘솔 에러 점검 (모두 동일 환경 CSP 이슈 5건 — 렌더 자체 무관)
- [x] PARAMS 인식 점검 (35/35)
- [x] evaluator 실패 점검 (0건)
- [x] 시각 부적절 4건 발견 → fix task spawn

## 첨부

- 105 screenshots: `wiki/05-reports/screenshots/TM-43/`
- next.config.ts 변경 (allowedDevOrigins) — 본 PR 코드 변경

## OpenAI 비용

$0 (생성 0회).

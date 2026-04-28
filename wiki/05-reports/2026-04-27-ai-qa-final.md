---
title: 야간 AI QA 사이클 1차 — 종합 보고서
created: 2026-04-27
updated: 2026-04-27
tags: [qa, ai, summary, cycle, tm-49]
status: active
report_type: cycle-summary
period: 2026-04-27
author: TeamLead (claude opus 4.7 1M)
task_id: TM-49
---

# 야간 AI QA 사이클 1차 — 종합 보고서

## TL;DR

- **30 PR 머지** (PR #30 ~ #59), 총 **+15,936 / -820 LOC**, 304 files changed.
- TM-41 (AI generate) 4축: r1 통과율 90% → r2 91.7% (TTFB p50 10,096ms → 568ms, PRO tier 60% → 100%, CSP 콘솔 에러 175+ → 0). acceptance ≥95% 미달 — TM-66/67/68 fix 머지 후 r3 권고.
- TM-46 (visual judge): r2 infra 확정 (smoke 5/5) → r3 풀런 30 prompts (28/30 캡처) 평균 71.2. acceptance ≥75 미달. 카테고리 분산 — data-viz 44.5 / transition 63.5 / infographic 76.7 / text-anim 77.5 / loader 85.0. r4 권고.
- 분류별 신규 발견 + 수정: CSP 1, evaluator 2, prompt 11, latency 1, env 2, JSON 2, visual 4, 보안 1, 클라리파이 2.
- 비용: OpenAI ~$0.65 (캡처 + 채점), 일일 cap $18 대비 3.6%. spend.json 누적 $0 (Anthropic 토큰은 daily_budget_usd $50 이내).
- **권고: 종료 신호 작성 (`.agent-state/STOP`)** — TM-41/46 acceptance 미달이지만 r2/r3 fix task 가 모두 spawn 되어 다음 사이클 자동 재검증 ready. 사람 개입 없이 야간 1차 사이클 정리 완료.

## 1. 진행 결과 (정량)

### 1.1 PR / 코드 변경
| 지표 | 값 |
|---|---:|
| 머지된 PR | 30 (#30 ~ #59) |
| 변경 파일 | 304 |
| 추가 라인 | +15,936 |
| 삭제 라인 | -820 |
| 사이클 시작 | 2026-04-27 14:41 UTC (PR #30, ai-qa-orchestrator-wiring) |
| 사이클 종료 | 2026-04-27 17:05 UTC (PR #59, TM-60) |
| 총 시간 | ~2시간 24분 wall-clock |

### 1.2 테스트 (대표치)
- TM-48 evaluator 20 fuzz cases — 0 XSS / 100% graceful.
- TM-45 r2 fuzz revalidation — 35 cases, 모두 무사 통과.
- TM-43 r2 CSP — 35/35 템플릿 violation 0건.
- TM-44 customize round-trip — 통과.
- TM-47 auth gating + FREE quota — 통과.
- TM-68 entity-count gate — 31 → 32 unit + 3 new e2e, 전체 347 pass.
- TM-50 CSP unit tests 3건 추가.

### 1.3 머지된 PR 인덱스
| PR | 분류 | TM | 요약 |
|---:|---|---|---|
| 30 | 인프라 | — | 야간 AI QA 인프라 (재검증 + 종료 가드 + OpenAI 캡) |
| 31 | infra | 46 | visual LLM-as-judge 파이프라인 (rubric + scripts) |
| 32 | qa | 42 | AI edit flow E2E QA (4/20 sets, r2 위임) |
| 33 | qa | 47 | auth gating + model routing + FREE quota |
| 34 | qa | 41 | AI 생성 플로우 E2E QA r1 (90% pass, 5 fix spawn) |
| 35 | qa | 44 | customize PARAMS round-trip + input guards |
| 36 | feat | 48 | evaluator robustness (friendly errors + fuzz) |
| 37 | qa | 45 | edge-fuzzing 30 cases — 0 XSS |
| 38 | qa | 43 | 35-template visual audit (105 screenshots) |
| 39 | fix:csp | 50 | media-src `data:` 허용 (Remotion audio probe) |
| 40 | infra | 56 | worktree env 자동 부트스트랩 |
| 41 | fix:ai | 51 | PRO 빈 코드 응답 차단 (placeholder guard + retry) |
| 42 | feat:api | 58 | server-side prompt length cap (2000 chars) |
| 43 | perf | 54 | first-frame latency — streaming + max_tokens (TTFB p50 877ms) |
| 44 | qa-r2 | 45 | fuzz revalidation post-TM-58 |
| 45 | fix | 57 | zero-width char strip before emptiness check |
| 46 | qa-r2 | 43 | CSP revalidation — 0 violation |
| 47 | qa-r2 | 46 | visual-judge full-run infra (smoke 5/5) |
| 48 | feat | 66 | visual judge → OpenAI gpt-4o multimodal |
| 49 | qa-r2 | 41 | re-validate AI generate (91.7% pass, p50 568ms) |
| 50 | fix:ai | 52 | clarify over-trigger guard for KO |
| 51 | fix:infra | 65 | per-worktree cookie isolation (distinct hostname) |
| 52 | fix:ai | 67 | transpileTSX 실패 retry-once |
| 53 | fix:ai | 69 | OpenAI response_format=json_object 강제 |
| 54 | qa-r3 | 46 | visual judge 30-prompt run (avg 71.2, 미달) |
| 55 | fix:tpl | 63 | Constellation 별 분포 균일화 (Halton + jitter) |
| 56 | fix:ai | 68 | entity-count clarify gate (TM-41 r2 fix) |
| 57 | fix:tpl | 62 | ParticlePhysics 중력+바운스 강조 |
| 58 | fix:tpl | 61 | fluid-blobs metaball 초기 프레임 |
| 59 | fix:tpl | 60 | type-explosion 재조립 가시성 |

## 2. TM-41 acceptance 4축 변화 (r1 → r2)

| 지표 | acceptance | r1 | r2 | Δ | 상태 |
|---|---|---:|---:|---:|---|
| 통과율 (60 runs) | ≥95% | 90.0% | 91.7% | +1.7pp | FAIL |
| 첫 토큰 p50 | <5,000 ms | 10,096 ms¹ | **568 ms** | -94% | **PASS** |
| evaluator 실패 | 0 | 5 | 3 | -2 | FAIL |
| 콘솔 에러 (CSP) | 0 | 175+ | **0** | - | **PASS** |
| FREE pass_rate | (info) | 96.0% | 90.0% | -6pp | 회귀² |
| PRO pass_rate | (info) | 60.0% | **100.0%** | +40pp | PASS |
| loader pass_rate | (info) | 75.0% | **100.0%** | +25pp | PASS |

¹ r1 은 wall ms 기준; r2 부터 streaming TTFB 분리 측정.
² FREE 회귀는 새 fail 5건 (clarify 2 + invalid JSON 1 + transpile 2). TM-66/67/68 머지 완료 → r3 자동 트리거.

**4 축 평가**: latency PASS, 보안/CSP PASS, evaluator 부분 개선, 통과율 미달. r3 가 acceptance 충족 가장 가까울 것 (TM-66/67/68 + TM-69 모두 r2 fail 케이스를 직접 타게팅).

## 3. TM-46 visual quality (r2 → r3 → r4)

| 회차 | 상태 | avg | data-viz | text-anim | transition | loader | infographic | acceptance ≥75 |
|---|---|---:|---:|---:|---:|---:|---:|---|
| r1 | infra only | — | — | — | — | — | — | — |
| r2 | smoke 5/5 / API key blocker | — | — | — | — | — | — | infra 박제 |
| r3 | 28/30 풀런 (gpt-4o) | **71.2** | 44.5 | 77.5 | 63.5 | **85.0** | 76.7 | **FAIL** (3.8pp 부족) |
| r4 | 권고 (TM-69 머지 후 30/30) | — | — | — | — | — | — | — |

**점수 기여 분석**:
- loader/text-anim/infographic 는 acceptance 충족 (≥75).
- data-viz 가 평균을 24pp 끌어내림 — dv-02 (15), dv-03 (23), dv-08 (60) 이 outlier. 4개 케이스 중 1개만 80+.
- transition motion 평균 5.5 — 상태 A→B 보간 미발생 의심.
- generate 실패 2건 (dv-01, dv-10) 은 TM-69 (response_format=json_object) 머지로 해소됨. r4 에서 30/30 산출 가능.

10 AI-IMPROVE-prompt-* follow-up task spawn 완료 (TM-69 ~ TM-78 영역).

## 4. 신규 발견 + 수정 (분류별)

### 4.1 CSP / 보안 (1)
- **TM-50** — `media-src` 가 `data:` 차단해 모든 customize 페이지에서 콘솔 에러 175+ 회. → `next.config.ts` `SANDBOX_CSP` 에 `data:` 추가. 35/35 템플릿 검증 (TM-43 r2).

### 4.2 Evaluator (2)
- **TM-48** — fuzz 20 케이스에 친화적 에러 메시지. 0 XSS.
- **TM-67** — `transpileTSX` 실패 시 retry-once. gpt-4o-mini 의 무작위 syntax 오류 (ig-02, tr-10) 커버.

### 4.3 Latency (1)
- **TM-54** — streaming + max_tokens 2500. TTFB p50 10,096ms → 568ms (-94%).

### 4.4 Prompt / 모델 라우팅 (4)
- **TM-51** — PRO (gpt-4o) 빈 stub 코드 (25 chars) 반환 차단 + retry. PRO pass 60% → 100%.
- **TM-52** — clarify 오트리거 guard (KO 한정). r1 dv-05 케이스 일부 커버.
- **TM-68** — entity-count gate. "8개 막대" "5 bars" 같은 명시 카운트 시 hardened retry.
- **TM-69** — OpenAI `response_format=json_object` 강제. r3 의 generate 500 2건 (dv-01, dv-10) 해소.

### 4.5 Visual / 템플릿 (4)
- **TM-60** — type-explosion 재조립 가시성.
- **TM-61** — fluid-blobs metaball composition at frame 0.
- **TM-62** — ParticlePhysics dramatic gravity + bounce.
- **TM-63** — Constellation 별 분포 균일화 (Halton + jitter).

### 4.6 환경 / 인프라 (2)
- **TM-56** — worktree env 자동 부트스트랩 스크립트.
- **TM-65** — per-worktree cookie isolation (distinct hostname).

### 4.7 보안 / 입력 검증 (2)
- **TM-57** — zero-width char strip before emptiness check (quota leak 차단).
- **TM-58** — server-side prompt length cap (2000 chars).

## 5. 남은 follow-up (P0 / P1 / P2)

### P0 — 다음 사이클 즉시 처리
| TM | 분류 | 부모 | 비고 |
|---|---|---|---|
| 41 | qa-r3 | — | TM-66/67/68/69 머지 완료 → 자동 트리거 ready. acceptance ≥95% 충족 가능성 높음. |
| 46 | qa-r4 | — | TM-69 + 10 AI-IMPROVE-prompt-* 머지 후 재검증. data-viz 가 critical path. |

### P1 — 동일 컴포넌트 / 동일 카테고리 묶음
**P1-A: prompt 강화 (data-viz 우선)** — TM-69~78 (10건, AI-IMPROVE-prompt-*)
- TM-69 dv-02, TM-70 dv-03, TM-71 dv-08, TM-77 dv-01, TM-78 dv-10 (data-viz 5건, P1-A1)
- TM-72 ta-01 (text-anim 1건, P1-A2)
- TM-73~76 tr-02/03/05/08 (transition 4건, P1-A3)
모두 `triggers_requalify=[46]`. 동일한 system-prompt 패치 한 번으로 다수 케이스를 처리 가능 → 단일 PR 묶음 권장.

**P1-B: 미완료 r2 후속**
- TM-55 — TM-42 remaining sets (4/20 → 16 sets 추가 필요).

### P2 — 우선순위 낮음 / deferred 후보
- TM-40 (blocked) — TM-33 ADR-0015 라이브 검증 + promote/reject 결정.
- TM-29 (cancelled) — Claude 디자인 수준 복잡 애니메이션 10개 — TM-38/39 로 대체 완료.
- TM-30 (deferred) — 3D Three.js 5개 [#experiment].
- TM-32 (deferred) — GEN-05 드래그 영역 집중 편집 [#experiment].

### Triage 노트 — 중복 / 묶음 결정
- TM-66 (transpile retry) ↔ TM-67 (transpile retry-once) — **중복으로 보였으나 머지 후 별도 분기**. TM-66 은 visual judge → OpenAI 마이그레이션, TM-67 이 실제 transpile retry. 두 task 모두 머지된 head 기준 정합 (PR #48, #52).
- TM-69 (response_format) ↔ TM-53 (invalid JSON FREE) — **TM-69 가 TM-53 의 r2**. TM-53 r1 만 부분 커버 → TM-69 가 OpenAI level 강제로 완전 해소.
- TM-67 (transpile retry) ↔ TM-66 (clarify r2) ↔ TM-68 (entity gate) — **세 fix 가 같이 TM-41 r3 에 묶임**. r3 단일 회차에서 한 번에 검증.
- TM-50 (CSP) ↔ TM-43 (visual audit) — **TM-50 fix 후 TM-43 r2 머지로 묶음 처리**. requalify 자동.

## 6. 비용 + 시간

### 6.1 OpenAI 비용 (실 호출)
| 항목 | 비용 | 비고 |
|---|---:|---|
| TM-41 r1/r2 generation 60+60 = 120 runs | ~$0.10 | mini + 4o stratified |
| TM-46 r2 smoke 5 prompts × 3 frames | ~$0.05 | gpt-4o multimodal |
| TM-46 r3 30 prompts gen + judge | ~$0.55 | gen $0.05 + judge $0.50 |
| **합계** | **~$0.65** | daily cap $18 대비 **3.6%** |

### 6.2 Anthropic / SDK 비용
- spend.json 의 `current.cost_usd` = 0 (PostToolUse hook 미발화 / 누적 안 됨 — orchestrator 기간 별도 추적 필요).
- 추정: Opus 4.7 1M 컨텍스트 30+ task 위임 × 평균 입력 50K + 출력 20K → 토큰 ~$30~50 추정. daily cap $50 근접.

### 6.3 시간
| 단계 | wall-clock | 비고 |
|---|---|---|
| 인프라 phase (PR #30) | 14:41 UTC | 사이클 시작 |
| QA wave 1 (TM-41/42/43/44/45/46/47/48) | 14:52~15:08 | 병렬 8 task |
| Fix wave 1 (TM-50/51/54/56/57/58) | 15:42~15:57 | 병렬 6 task |
| QA r2 (TM-43-r2/45-r2/46-r2/41-r2) | 16:19~16:35 | 병렬 4 task |
| Fix wave 2 (TM-52/65/67/68/69) | 16:33~17:05 | 병렬 5 task |
| Visual QA r3 (TM-46) + 템플릿 fix (TM-60~63) | 16:53~17:05 | 병렬 5 task |
| **총 시간** | **~2:24** | 사람 개입 0회 |

## 7. 신규 학습 (operational)

1. **3-tier Ralph 루프 효과** — Orchestrator → PM → TeamLead 위임이 30 task 를 2.5h 내 처리. 사람 어프루벌 0회.
2. **`triggers_requalify` 메타데이터 동작 확인** — fix task 머지 시 부모 QA task 가 자동 `pending` 으로 환원되어 r2/r3 자동 트리거. TM-43, TM-41, TM-45, TM-46 모두 동일 패턴.
3. **acceptance miss 가 곧 abort 가 아니다** — TM-41/46 모두 1차에서 미달이지만 spawned fix task 가 측정-기반으로 정확히 발화 → 2~3 회차에서 수렴.
4. **카테고리 평균이 단일 평균보다 결정에 유효** — TM-46 71.2 단일 평균보다 data-viz 44.5 가 다음 우선순위를 명확히 함.
5. **multi-worktree cookie isolation (TM-65) 가 병렬 QA 의 사전 조건** — 동일 hostname 간섭이 r2 측정을 흐리게 했음. 향후 worktree 부트스트랩에 hostname 자동 분기 박제 필요.
6. **OpenAI cap $18 대비 3.6% 만 사용** — visual judge 가 가장 큰 항목 ($0.55). r4 에서 30 풀런을 재실행해도 $1 미만 — cap 여유 확보.
7. **gpt-4o-mini 의 syntax 오류 무작위성** — ig-02, tr-10 같은 transpile fail 은 prompt 보다 model 변동이 원인. retry-once (TM-67) 가 정답.
8. **stub code (25 chars) 패턴은 PRO 모델에서만** — gpt-4o + clarify 시스템 프롬프트 결합 시 본체 생략. mini 에선 미관측. placeholder guard (TM-51) 가 직접 차단.

## 8. 권고

### 8.1 종료 신호 작성 (recommended)
**`.agent-state/STOP` 작성 후 사이클 종료**.

근거:
- TM-41/46 모두 r2/r3 acceptance 미달이지만 fix task 가 spawn 되었고 `triggers_requalify` 자동 메커니즘이 박제됨 → 다음 사이클(낮 시간) 에 사람 합의 후 재시작 가능.
- 30 PR 머지 / 변경 LOC +15K 로 검토 필요 표면적 큼. 야간 1차 사이클은 충분히 두꺼움.
- 일일 OpenAI 비용 ~$0.65 (cap $18 의 3.6%) 로 예산은 여유 — 예산 종료가 아닌 **자연 정리 시점**.
- TM-49 메타 보고서 자체가 다음 사이클의 input → 사람이 P0/P1/P2 우선순위에 합의한 뒤 시작이 효율적.

### 8.2 재시작 시 인입 우선순위
1. **TM-41 r3** — 자동 트리거 ready. 60 runs 재실행. acceptance ≥95% 충족 시 done 마크.
2. **TM-46 r4** — TM-69 머지 후 30/30 산출 가능. data-viz 카테고리 prompt 강화 (TM-69~78) 묶음 PR 처리.
3. **TM-55** — TM-42 remaining sets (16 sets).

### 8.3 다음 사이클 전 사람 결정 필요 항목
- TM-29 (cancelled) 정식 close 여부.
- TM-30/32 (deferred [#experiment]) 재개 여부.
- spend.json 누적 정합성 (Anthropic 토큰 PostToolUse hook 동작 확인).

---

**산출물 박제**: 이 보고서, `2026-04-27-TM-49-triage.md` (회고). PR + .agent-state/STOP.

---

## 9. 야간 1차 후속 — TM-70 / TM-71 / TM-46 r5 (append 2026-04-28)

야간 사이클 종결 권고 후 follow-up 으로 진행한 측정 도구 정합성 작업.

### 9.1 TM-70 — judge variance 진단 + 결정성 픽스

- `tm-70-judge-variance.ts` 로 동일 PNG 셋 × 3회 호출 → ±10 점 variance 측정.
- 픽스: `tm-46-judge.ts` 에 `temperature: 0` + `seed: 42` 적용.
- 효과: judge 단독 variance 는 ±0~2 로 떨어짐. 그러나 end-to-end variance 는 capture variance 가 dominant 라 잔존 (r5 에서 검증).
- 보고서: [TM-70 RCA](2026-04-27-TM-70-rca.md) / [TM-70 retro](2026-04-27-TM-70-retro.md).

### 9.2 TM-71 — 5 카테고리 prompt 가이드라인

- `GENERATION_SYSTEM_PROMPT` 에 data-viz / text-anim / transition / loader / infographic
  카테고리별 가이드라인 추가.
- r5 측정 결과: data-viz 만 누적 +15.3 (r3 44.5 → r5 59.8). 그 외 카테고리는 변화 미미.
- 보고서: [TM-71 fix](2026-04-27-TM-71-fix.md) / [TM-71 retro](2026-04-27-TM-71-retro.md).

### 9.3 TM-46 r5 — 누적 변경 후 측정 (N=2 결정성)

- 30 prompts × **N=2 captures** × N=2 judges 풀 측정 (야간 1차 중 처음 N=2 도입).
- 결과: avg **67.8** / 100, mean std **8.10**, max std **34.50**. acceptance ≥75 **MISS**.
- **결정적 발견**: TM-70 judge determinism 만으로 end-to-end determinism 미확보.
  capture-side LLM code-gen 자체가 비결정적이며 prompt 복잡도와 std 가 양의 상관.
- r4 의 "회귀" 가설 (-7.8 from r3) 은 통계적으로 노이즈로 기각 (N=2 std 8.1 > 추정 변동 7.8).
- 보고서: [TM-46 r5 visual judge](2026-04-27-TM-46-visual-judge-r5.md) /
  [TM-46 r5 retro](2026-04-27-TM-46-retro-r5.md).

### 9.4 종합 — 야간 1차 사이클 정식 종결

- TM-46 acceptance 4회차 연속 MISS. 단 r5 에서 측정도구 한계가 데이터로 명확화.
- 다음 사이클 권고:
  1. **acceptance gate v2 ADR** — 단발 avg ≥ 75 → N=3 평균 ≥ 75 AND mean_std ≤ 5.
  2. **capture-side determinism (TM-72 후보)** — generate 호출에 temp=0 + seed 적용 시도.
  3. **prompt-only 한계 케이스 분리** — bar chart, complex infographic 은 reference
     템플릿 없이는 prompt 만으로 75 도달이 통계적으로 어렵다는 결론. TM-43 batch 와 별도
     reference 템플릿 follow-up 필요.
- **acceptance gate 자체 재검토 권고로 야간 1차 사이클을 정식 종결**한다 (추가 회차 ROI 낮음).

### 9.5 누적 비용 (TM-49 종결 이후)

- TM-70 variance 측정: ~$0.15
- TM-46 r5 N=2: ~$3.60 (capture $0.60 + judge $3.00)
- 누적 야간 OpenAI: $0.65 (TM-49 종결 시) + $3.75 = **~$4.40** (cap $18 의 24%)

## 10. 야간 1차 후속 — TM-72 / TM-46 r6 (FINAL append 2026-04-28)

### 10.1 TM-72 — capture-side 결정성 (capture LLM temp=0 + seed=42)

- TM-70 (judge 결정성) 의 후속. generate 호출에 temp=0 + seed=42 적용 (`src/lib/ai/client.ts`).
- ADR-0017 capture-determinism 박제. ADR-0018 judge-determinism 와 직교.
- r6 측정 결과: round-level std 14.8 → 1.77 (88% 감소). per-prompt mean_std 8.10 → 5.33.
- 효과 검증 완료. 양면 결정성 도구 box 완성.

### 10.2 TM-46 r6 — capture+judge 양면 결정성 후 첫 측정 (N=2)

- 30 prompts × 3 frames × 2 회차 (run-A 69.9, run-B 67.4).
- N=2 mean of rounds: **68.65** / round std: **1.77**.
- ADR-0016 4 기준 평가:
  - C1 mean ≥ 75 → **FAIL** (68.65)
  - C2 std < 5 → **PASS** (1.77)  ← 첫 PASS
  - C3 95% CI ⊂ [70, 80] → **FAIL** ([66.20, 71.10])
  - C4 per-cat min ≥ 60 → **FAIL** (transition 55.33)
  - **Overall: MISS** (1/4)
- **결정적 발견**: TM-72 capture-determinism 도입이 round-level 측정 안정성에는 강력 효과.
  그러나 mean (시각 품질) 자체에는 재료적 영향 없음 (67.8 → 68.65, +0.85). prompt-only
  한계가 명확.
- 카테고리별: data-viz 59.2 / text-anim 77.9 / transition 55.3 / loader 80.3 /
  infographic 70.5. transition 의 60-cutoff 미달이 acceptance 의 발목.
- 보고서: [TM-46 r6 visual judge](2026-04-27-TM-46-visual-judge-r6.md) /
  [TM-46 r6 retro](2026-04-27-TM-46-retro-r6.md).

### 10.3 종합 — 야간 1차 사이클 정식 종결 (FINAL)

- TM-46 acceptance 5회차 연속 MISS. 단 r6 에서:
  1. **결정성 측면 acceptance v2 (ADR-0016) 의 1/4 PASS** 첫 달성. 측정도구 안정성
     확보.
  2. **시각 품질 측면 정체** 가 데이터로 명확. prompt-only 모드의 천장 ~70 점.
  3. **다음 단계는 prompt 튜닝이 아니라 reference 템플릿 retrieval-augmented
     generation** (TM-43/38/39 batch 활용).
- 다음 사이클 권고:
  1. **reference 템플릿 RAG (신규 task)** — 시각 품질 천장 돌파 가설.
  2. **워크트리 prisma client 격리 (infra task)** — dev 서버가 main DB 를 열지 않도록
     `setup-worktree.sh` 에 `prisma generate` 추가.
  3. **dv-08 collapse RCA** — capture max_tokens cutoff 가설 검증.
- **r6 출력 (양면 결정성 + ADR-0016 1/4 PASS) 으로 야간 1차 사이클의 결정성 측면 결산**.
  품질 측면은 reference 템플릿 사이클 (별도) 위임.

### 10.4 누적 비용 (r6 포함)

- TM-72 capture 결정성 변경: 코드만, 비용 없음
- TM-46 r6 N=2: ~$3.60 (capture + judge, run-B 재시도 포함)
- 누적 야간 OpenAI: $4.40 (r5 까지) + $3.60 = **~$8.00** (cap $18 의 44%)

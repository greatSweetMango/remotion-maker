---
name: judge-acceptance
description: 표준 LLM-as-judge 워크플로 (corpus → judge → score → 4-criteria acceptance gate). AI 출력(시각/코드/프롬프트) 품질을 결정적(deterministic)으로 채점하고 ADR-0016/0017/0018 규약에 따라 PASS/FAIL 판정한다. ai-quality-judge agent 의 1차 호출 entry point. TM-46 (visual judge), TM-66 (gpt-4o multimodal), TM-70 (variance RCA), TM-73 (acceptance gate v2), TM-85 (pipeline mode_match judge 단계), TM-108 (data-viz bench) 등에서 사용. 새 judge run 을 추가하거나 회귀 회차를 돌릴 때 본 skill 을 통해 표준 산식/산출물 포맷을 강제한다.
---

# judge-acceptance

LLM-as-judge 호출 + 4-criteria acceptance gate 의 **표준 워크플로**. 본 skill 은 `ai-quality-judge` agent 의 일차 검증 경로이며, 일반 TeamLead 도 judge 단계만 직접 부르고 싶을 때 호출할 수 있다.

## 언제 사용하나

다음 중 하나에 해당하면 본 skill 을 호출한다:

1. AI 출력 품질을 LLM 으로 채점해야 함 (시각/코드/prompt-effectiveness).
2. acceptance gate (PASS/FAIL) 판정이 필요함 — 단일 회차 평균만으로 결론 내지 마라.
3. 회차 간 비교 (Δavg, noise band) 보고서를 만들어야 함.
4. judge 결정성(seed/temp/N) 가드를 강제하고 싶음.

## 입력 파라미터

```jsonc
{
  "corpus_path": "__tests__/benchmarks/results/tm-46/screenshots",  // 또는 코드/프롬프트 corpus 경로
  "judge_model": "gpt-4o",                                          // 기본; env JUDGE_MODEL 으로 override 가능
  "criteria": ["layout", "typography", "motion", "fidelity"],       // visual 기본 4축; 코드 judge 면 ["correctness","idiom","safety","style"]
  "n_shots": 3,                                                     // ADR-0018 N≥3 기본
  "seed": 42,                                                       // ADR-0018 고정 — 변경 시 ADR amend 필요
  "temperature": 0,                                                 // ADR-0018 고정
  "smoke": false,                                                   // true 면 1 prompt 만 호출 (~$0.01)
  "out_path": "__tests__/benchmarks/results/tm-46/scores-<round>.json",
  "round_label": "r8"                                               // 회차 식별
}
```

## 산출물 스키마 (`scores.json`)

판정 결과 JSON 은 ADR-0016/0018 호환 필드를 반드시 포함한다:

```jsonc
{
  "model": "gpt-4o",
  "ran_at": "ISO8601",
  "n": 30,
  "n_shots": 3,
  "seed": 42,
  "temperature": 0,
  "avg_overall": 74.2,
  "delta_vs_prev_round": -0.6,
  "noise_band": 10,                  // ADR-0018 floor — Δ < 이 값이면 regression/improve 라벨 금지
  "axis_floors": {
    "layout": 7.0,
    "typography": 7.0,
    "motion": 6.5,
    "fidelity": 7.5
  },
  "acceptance": {
    "passed": false,
    "reasons": ["typography axis < floor (6.4)", "noise band 내 — 회차 단독 신뢰도 부족"]
  },
  "followup_count": 4,
  "results": [
    {
      "id": "ta-02",
      "category": "data-viz",
      "overall_score": 71,
      "runs": [69, 73, 71],
      "delta_max": 4,
      "std": 1.6,
      "judge": { /* per-run frame scores + comment */ },
      "needs_followup": false
    }
  ]
}
```

## 워크플로 단계

### Step 1 — 사전 가드

```bash
test -n "$OPENAI_API_KEY" || { echo "OPENAI_API_KEY missing"; exit 1; }
test -d "$CORPUS_PATH" || { echo "corpus missing: $CORPUS_PATH"; exit 1; }
```

`.env.local` 은 worktree root 에서 dotenv 로 자동 로드 (TM-66 패턴). 별도 export 불요.

### Step 2 — variance probe (한 회차당 1회, mandatory)

```bash
npx tsx __tests__/benchmarks/tm-70-judge-variance.ts
```

기대: 동일 sample × N=3 호출의 Δmax 평균 ≤ 3 점 (ADR-0018 floor).
초과 시 즉시 abort — judge 호출의 `seed`/`temperature` drift 의심. 본 skill 의 후속 step 진입 금지.

### Step 3 — judge 호출 (corpus 전체)

visual 기본 경로:

```bash
npx tsx __tests__/benchmarks/tm-46-judge.ts \
  --screenshots-dir "$CORPUS_PATH" \
  ${SMOKE:+--smoke} \
  --out "$OUT_PATH"
```

코드 judge / prompt-effectiveness 변형은 본 entry 의 fork 를 호출 (예: `tm-108-r5-judge.ts`). 새 변형을 추가할 때는 반드시:

- `temperature: 0`, `seed: 42`, `response_format: { type: 'json_object' }` 유지
- multimodal 입력 라벨 (`Frame N:`) 보존
- 출력 JSON 에 `runs[]`, `delta_max`, `std` 필드 포함 (N≥3 호출의 결과)

### Step 4 — acceptance gate 산식 적용 (4-criteria)

산식 (ADR-0016):

1. **per-sample**: 4축 각각 ≥ axis_floor → PASS. 한 축이라도 floor 미달이면 sample FAIL.
2. **회차 평균**: PASS 비율이 ≥ 80% 면 회차 PASS.
3. **Δavg vs 이전 회차**: |Δ| < noise_band (기본 10) → "noise band 내" 분류, 회귀/개선 라벨 금지.

산식 결과를 `scores.json` 의 `acceptance.passed` + `acceptance.reasons` 에 반영.

### Step 5 — follow-up spawn 권고 출력

`needs_followup == true` 인 sample 에 대해 spawned_tasks placeholder 를 만들어 TeamLead Phase F 의 요약 JSON 에 박는다 (TM-97 규약 — 워크트리에서 `task-master add-task` 직접 호출 금지).

```jsonc
{
  "placeholder_id": "TM-<parent>-spawn-<n>",
  "title": "AI-IMPROVE-<category>-<slug>",
  "description": "<prompt> — judge <overall_score>/100. <improvement_suggestion>",
  "details": "발견자: TM-<parent>. 재현: ... 첨부: <screenshot path>. metadata: {\"triggers_requalify\":[\"<parent>\"],\"qa_iteration\":<n>}",
  "priority": "medium",
  "dependencies": ["<parent>"],
  "triggers_requalify": ["<parent>"]
}
```

### Step 6 — retro 본문 표 강제

TeamLead 의 retro (`wiki/05-reports/<date>-TM-X-retro.md`) 에 다음 2 표를 의무 포함:

1. **acceptance matrix**: 4축 × 회차 평균 + floor 위반 여부.
2. **per-sample variance**: 상위 5 sample 의 `runs[]`, `delta_max`, `std` — noise 큰 sample 식별.

표 누락 시 verdict APPROVE 금지.

## 사용 시나리오 매핑

| Task line | Step 3 entry | Step 4 floor source | 비고 |
|---|---|---|---|
| TM-46 r2~r7 (visual judge 회차) | `tm-46-judge.ts` | ADR-0016 §axis_floors | 30 prompts × 3 frames |
| TM-66 (gpt-4o multimodal migrate) | `tm-66-smoke.ts` → `tm-46-judge.ts` | smoke 통과 후 full | judge model `gpt-4o` |
| TM-70 (variance RCA) | `tm-70-judge-variance.ts` 단독 | Δmax ≤ 3 | seed/temp 검증 전용 |
| TM-73 (acceptance gate v2 도입) | `tm-46-judge.ts` re-run | 4-criteria 신규 floor | ADR-0016 amend |
| TM-85 / TM-106 (pipeline mode_match judge 단계) | `scripts/qa/tm-85-pipeline-quality.mjs` | mode_match ≥ 28/30 | judge 단계만 본 skill 적용 |
| TM-108 (data-viz bench) | `tm-108-bench.ts` + `tm-108-r5-judge.ts` | category 단위 floor | 부분 capture 시 r5-judge 패턴 |

## 도메인 규약 요약 (직접 참조)

- **ADR-0016** — 4-criteria acceptance gate, multi-run (N≥3). 단일 회차 단일 평균 PASS/FAIL 금지.
- **ADR-0017** — capture-side LLM `temperature=0, seed=42`. judge 비교 입력 자체의 결정성 보장.
- **ADR-0018** — judge-side LLM `temperature=0, seed=42`. N≥3. variance floor Δmax ≤ 3.

본 규약을 깨는 변경은 skill 안에서 처리하지 말고 즉시 escalate → `ai-quality-judge` agent 또는 Orchestrator.

## 금지

- N=1 호출 결과만으로 acceptance PASS/FAIL 결론.
- `temperature` 또는 `seed` 누락된 judge 호출 도입.
- `scores.json` 에서 `runs[]`, `delta_max`, `std` 필드 제거.
- 한 PR 에서 4축 rubric 정의를 두 곳 이상 동시 변경 (회차 비교 무효화).
- 새 model provider 도입 (Anthropic 등 SDK seed 미지원 — escalate).
- 워크트리 내부에서 `task-master add-task` 직접 호출 (TM-97 — placeholder 만 사용).

## 관련

- Agent: `.claude/agents/ai-quality-judge.md` — 본 skill 의 표준 caller
- ADR: `wiki/01-pm/decisions/0016-acceptance-gate-v2.md`, `0017-capture-determinism.md`, `0018-judge-determinism.md`
- 회고: `wiki/05-reports/2026-04-27-TM-46-visual-judge*.md`, `2026-04-27-TM-66-judge-migration.md`, `2026-04-27-TM-70-rca.md`
- Generic TeamLead SOP: `prompts/team-lead.md`

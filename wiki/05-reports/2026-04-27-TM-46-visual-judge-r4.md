---
title: TM-46 r4 — Visual judge 4회차 (avg 63.4 / acceptance 미달, regression)
created: 2026-04-27
updated: 2026-04-27
tags: [qa, llm-judge, r4, visual, regression]
status: active
report_type: session
---

# TM-46 r4 — Visual LLM-as-judge 실행 보고 (회귀)

## TL;DR

- 동일 30 프롬프트 × 3 프레임 재실행. judge = OpenAI gpt-4o (TM-66 마이그레이션).
- **avg = 63.4 / 100** (n=29; ld-09 generate 500 1건 제외). r3 71.2 대비 **-7.8 회귀**.
- acceptance(>=75) 여전히 미달. 새 follow-up 15건 (r3 10건보다 증가).
- 예상과 달리 **transition / infographic 카테고리에서 큰 회귀** 관측. data-viz 는 소폭 개선.
- 결론: TM-60~63 시각 템플릿 fix 머지가 점수에 **순효과를 주지 못함**. judge variance + 전반 prompt-only 이슈가 dominant.

## 회차 비교 (r3 → r4)

| 카테고리 | r3 avg | r4 avg | Δ | n(r3→r4) | 비고 |
|---|---|---|---|---|---|
| data-viz | 44.5 | **55.5** | +11.0 | 4→6 | dv-01/dv-10 generate 복구 (TM-69 효과). dv-02/dv-08 여전히 저점 (15/13). |
| text-anim | 77.5 | 71.8 | -5.7 | 6→6 | ta-01 (63), ta-04 (55) 신규 저점. variance 가능. |
| transition | 63.5 | **50.0** | **-13.5** | 6→6 | **tr-10 90 → 41 collapse**. tr-02 (43→35), tr-05 (68→48). |
| loader | 85.0 | 81.8 | -3.2 | 6→5 | ld-09 generate 500. 나머지는 안정적 (73-90). |
| infographic | 76.7 | **61.0** | **-15.7** | 6→6 | **ig-01 collapse (76 → 10)**. 나머지도 -5~-10. |
| **전체** | 71.2 | **63.4** | **-7.8** | 28→29 | acceptance 75 미달 유지. |

## r4 점수 표 (전체)

| ID | category | overall | r3 | flag |
|---|---|---|---|---|
| dv-01 | data-viz | 68 | gen-fail | (TM-69로 복구, OK) |
| dv-02 | data-viz | **15** | 15 | ⚠ 변화 없음 |
| dv-03 | data-viz | 74 | 23 | 큰 개선 (+51) |
| dv-06 | data-viz | 80 | 80 | 안정 |
| dv-08 | data-viz | **13** | 60 | ⚠ 회귀 (-47) |
| dv-10 | data-viz | 83 | gen-fail | (TM-69로 복구, OK) |
| ta-01 | text-anim | 63 | (n/a) | ⚠ |
| ta-02 | text-anim | 83 | (n/a) | |
| ta-04 | text-anim | 55 | (n/a) | ⚠ |
| ta-05 | text-anim | 80 | (n/a) | |
| ta-06 | text-anim | 73 | (n/a) | |
| ta-09 | text-anim | 77 | (n/a) | |
| tr-01 | transition | 68 | 79 | ⚠ -11 |
| tr-02 | transition | 35 | 43 | ⚠ -8 |
| tr-03 | transition | 65 | 53 | +12 |
| tr-05 | transition | 48 | 68 | ⚠ -20 |
| tr-08 | transition | 43 | 48 | ⚠ -5 |
| tr-10 | transition | **41** | 90 | ⚠ **collapse -49** |
| ld-01 | loader | 83 | (n/a) | |
| ld-02 | loader | 90 | (n/a) | |
| ld-03 | loader | 73 | (n/a) | |
| ld-05 | loader | 73 | (n/a) | |
| ld-06 | loader | 90 | (n/a) | |
| ld-09 | loader | n/a | (n/a) | gen 500 (TSX transpile fail) |
| ig-01 | infographic | **10** | 76 | ⚠ **collapse -66** |
| ig-02 | infographic | 59 | (n/a) | ⚠ |
| ig-03 | infographic | 65 | (n/a) | ⚠ |
| ig-04 | infographic | 83 | (n/a) | |
| ig-06 | infographic | 68 | (n/a) | ⚠ |
| ig-08 | infographic | 81 | (n/a) | |

(r3 비교 가능 항목은 dv- + tr-에 집중. text-anim/loader/infographic 은 r3 wiki 에 prompt-id 별 점수표가 부분만 있어 직접 비교는 dv/tr 만 안전.)

## 분석

### data-viz (44.5 → 55.5, +11.0)
- **TM-69 (json mode) 효과 확인** — dv-01/dv-10 둘 다 generate 정상화 (68/83 점).
- dv-03 큰 개선 (+51) — OpenAI 출력 변동성 또는 system-prompt 가 안정화된 결과.
- **dv-02 (15) / dv-08 (13) 은 여전한 저점** — bar chart / horizontal bar race 가
  prompt 만으로는 여전히 안 그려짐. data-viz 전용 reference 템플릿 필요.

### transition (63.5 → 50.0, -13.5)
- **tr-10 collapse 90 → 41** 가장 큰 충격. r3 에서 best case 였던 morph 가 회귀.
- tr-05 -20, tr-01 -11. 5/6 케이스에서 점수 하락.
- TM-60~63 머지는 transition 영역과 무관 (각각 type-explosion, fluid-blobs,
  particle-physics, constellation). transition prompt 자체 system-prompt 약함.
- judge 가 동일 PNG 셋에 대해 ±10~20 변동 가능 — 측정 노이즈도 의심.

### infographic (76.7 → 61.0, -15.7)
- **ig-01 collapse 76 → 10** (step indicator 1-2-3-4) — 가장 큰 회귀.
  ig-01 PNG 가 비어 있는 캔버스만 그려졌을 가능성 (judge "렌더링 문제" 코멘트).
- ig-02/ig-03/ig-06 도 -5~-10. 카테고리 전체 회귀.

### 카테고리 외 무관 변화
- TM-60 type-explosion / TM-61 fluid-blobs / TM-62 particle-physics / TM-63 constellation
  은 모두 **TM-39 batch 의 복합 모션 템플릿**이라 30 prompts 평가 셋과 직접 매칭되지 않음.
  → 평균 끌어올림 가설은 처음부터 약한 추론이었음.

## acceptance / next steps

- **avg 63.4 < 75 — REQUEST_CHANGES**.
- spawn 기준 (overall < 70) 15건. 대부분 r3 와 동일 또는 새로 떨어진 케이스.
- **권고**:
  1. judge variance 측정 — 동일 PNG 를 3회 호출해 ±std 측정. ±10 이상이면 단일
     회차 평균을 acceptance gate 로 쓰면 안 됨.
  2. **prompt-only 개선 한계** — bar chart, transition 은 reference 템플릿이 없으면
     prompt 만으로 점수 75 도달이 어렵다. 새 follow-up: data-viz/transition reference
     템플릿 추가 task.
  3. ig-01 / dv-02 / dv-08 / tr-02 는 generate 결과 코드 자체를 수동 검사해
     "왜 검정 화면" 인지 root cause 박제.

## 비용 / 시간

- generate 30 호출 × ~$0.01 = ~$0.30 (OpenAI gpt-4o-mini for code gen).
- judge 29 호출 (multimodal gpt-4o, 3 PNG/req) × ~$0.05 = ~$1.5.
- 캡처 시간 ~25 분 (체감), judge ~3 분.
- 인프라 변경: 0 (r3 driver/judge 재사용).

## 관련

- [TM-46 r3 보고서](2026-04-27-TM-46-visual-judge-r3.md) — 직전 회차 71.2.
- [TM-46 r2 보고서](2026-04-27-TM-46-visual-judge-r2.md) — 인프라 박제.
- [TM-46 retro r4](2026-04-27-TM-46-retro-r4.md).
- 결과 데이터: `__tests__/benchmarks/results/tm-46/scores.json` (gitignored — 본 PR 에선
  요약값만 박제).

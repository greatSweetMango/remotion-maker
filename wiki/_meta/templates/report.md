---
title: "<% tp.date.now('YYYY-MM-DD') %> — <보고 제목>"
created: <% tp.date.now("YYYY-MM-DD") %>
updated: <% tp.date.now("YYYY-MM-DD") %>
tags: [report]
status: active
report_type: session   # session | weekly | release | incident | meeting-summary
period: ""             # 예: "2026-04-25 ~ 2026-04-26", "2026-W17"
author: ""             # 사람/agent 이름
---

# <보고 제목>

## TL;DR

<3줄 이내 핵심 요약 — 무엇이, 왜, 다음은>

## 무엇이 바뀌었나

- 변경 1
- 변경 2

## 왜 / 배경

<이 작업이 왜 필요했는가, 어떤 문제/목표에서 출발했나>

## 영향

- 코드 / 시스템 영향
- 사용자/제품 영향
- 비용/성능 영향

## 후속 / 다음

- [ ] 후속 작업 📅 YYYY-MM-DD
- [ ] 검증 항목

## 출처 / 링크

- 코드: `../src/...`
- 관련 ADR: [[../01-pm/decisions/NNNN-...]]
- status 반영: [[../02-dev/status]]
- 원본 보고서: `../../docs/REPORT.md` (있을 경우)

---
title: "ADR-0003: 편집 요청에 프롬프트 캐싱을 적용한다"
created: 2026-04-18
updated: 2026-04-26
tags: [decision, area/edit, tech/anthropic]
status: accepted
---

# ADR-0003: 편집 요청에 프롬프트 캐싱을 적용한다

## 컨텍스트

Re-prompt 편집은 매번 (시스템 프롬프트 + 기존 코드 + 새 요청)을 LLM에 보낸다. 시스템 프롬프트와 기존 코드는 회당 동일하거나 거의 같음 → 입력 토큰이 절감 가능.

## 결정

Anthropic API의 `cache_control: { type: 'ephemeral' }`를 시스템 프롬프트와 기존 코드 블록에 적용한다.

## 결과

- 편집 1회 입력 토큰 비용 **약 90% 절감** (캐시 히트 시)
- Creative 등급 편집 실효 원가 ~$0.007
- Pro 무제한 편집을 마진 안에서 제공 가능

## 결과적 제약

- Ephemeral 캐시 TTL은 5분 — 그 안에 재요청해야 히트
- 캐시 키는 콘텐츠 해시 → 시스템 프롬프트가 바뀌면 모든 사용자 캐시 invalidate
- 캐시 hit 모니터링 필요 (관측 도구 미구현 — TODO)

## 관련

- 코드: `src/lib/ai/edit.ts`, `src/app/api/edit/route.ts`
- PRD §5.3 편집 요청 원가 최적화

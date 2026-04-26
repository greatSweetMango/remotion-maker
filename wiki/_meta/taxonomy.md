---
title: Tag Taxonomy
created: 2026-04-26
updated: 2026-04-26
tags: [meta]
status: active
---

# Tag Taxonomy

이 위키에서 사용 가능한 **정규 태그 사전**. 새 태그가 필요하면 먼저 여기를 업데이트한 뒤 사용한다.

## Domain

- `pm` — 제품 관리, 로드맵, 우선순위
- `decision` — 의사결정 (ADR 페이지)
- `meeting` — 회의록
- `dev` — 개발/엔지니어링
- `research` — 외부 리서치, 경쟁사 조사
- `idea` — 미가공 아이디어 (보통 inbox)
- `meta` — 위키 자체에 대한 메타 문서

## Area (제품 영역)

- `area/generate` — AI 에셋 생성 파이프라인
- `area/customize` — 동적 커스터마이징 UI
- `area/edit` — 편집 요청 (Re-prompt)
- `area/export` — Export 시스템 (Lambda)
- `area/templates` — 템플릿 갤러리
- `area/auth` — 인증/계정
- `area/billing` — 구독/결제 (Stripe)
- `area/infra` — 인프라/배포

## Status

- `status/active` — 진행 중
- `status/blocked` — 막힘
- `status/done` — 완료
- `status/parking` — 보류

## Priority

- `p0` `p1` `p2` — PRD와 동일한 우선순위 체계

## Tech

- `tech/nextjs` `tech/remotion` `tech/prisma` `tech/stripe`
- `tech/anthropic` `tech/lambda` `tech/tailwind`

## 사용 규칙

- 한 페이지에 5개 이하 권장
- `domain` 1개 + `area/*` 1~2개 + 그 외 보조 태그 조합이 일반적
- 신규 태그는 PR/커밋에서 review 대상

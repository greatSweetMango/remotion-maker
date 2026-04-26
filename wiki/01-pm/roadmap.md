---
title: Roadmap
created: 2026-04-26
updated: 2026-04-26
tags: [pm]
status: active
---

# Roadmap

> 출처: PRD §9 MVP Scope. 최신 상태는 [[../02-dev/status]] 참고.

## ✅ MVP 1차 (2026-04-18 빌드 완료)

`docs/REPORT.md` 참고. 16 commits, 19/19 테스트 통과, Next.js 16.2.4 빌드 성공.

- [x] Next.js 16 + Prisma 6 + NeonDB + NextAuth v5
- [x] Claude Haiku/Sonnet 기반 코드 생성
- [x] 브라우저 Player + sandbox evaluator
- [x] 동적 커스터마이징 UI (PARAMS 자동 추출)
- [x] Re-prompt 편집 + 프롬프트 캐싱 (~90% 토큰 절감)
- [x] Export: GIF / MP4 / WebM 투명채널 / React .tsx / Web embed
- [x] Stripe 구독 + Webhook
- [x] 템플릿 3종 (Counter, ComicEffect, BarChart)
- [x] 랜딩 + 갤러리 + Pricing

## 🔜 다음 (Pre-launch)

- [ ] **A1 검증** (HIGH risk): 커스터마이징 파라미터 추출 일관성 — 프롬프트 50회 테스트
- [ ] 환경변수 실제 키 주입 (Google OAuth, Stripe live, Anthropic, NeonDB)
- [ ] Vercel 배포 + 도메인 연결
- [ ] Remotion Lambda 프로덕션 셋업
- [ ] 추가 템플릿 7~17개 (총 10~20개 목표)
- [ ] SEO 랜딩 페이지 (animated chart generator 등)
- [ ] 베타 유저 모집 + 인터뷰

## 📅 v2 (Post-launch)

- [ ] 드래그 영역 편집 요청 (GEN-05)
- [ ] AI 역질문 인터랙션 (GEN-06)
- [ ] Pro/Team 크레딧 구매
- [ ] PNG 시퀀스 / ProRes / 4K (Team)
- [ ] AI 에이전트 Premium 등급 검토

## 🌌 v3+ (Out of scope for now)

PRD §12 참고 — 커뮤니티, 마켓플레이스, 3D, 모바일 앱, B2B API 등.

## 검증해야 할 핵심 가정

PRD §11 참고. **A1 (파라미터 자동 추출 성공률 80%)** 가 가장 중요한 사업 리스크.

- [[decisions/0002-customize-ui-auto-extract|ADR-0002: 커스터마이징 UI 자동 추출 전략]]

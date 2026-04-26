---
title: "2026-04-26 — Studio UX 개선 + Obsidian 위키 연동 세션"
created: 2026-04-26
updated: 2026-04-26
tags: [report, dev, area/customize, area/templates]
status: active
report_type: session
period: "2026-04-25 ~ 2026-04-26"
author: "Claude Code"
---

# 2026-04-26 — Studio UX 개선 + Obsidian 위키 연동

## TL;DR

Studio 중앙 패널에 TemplatePicker를 통합하고, 썸네일 검은 화면 버그(evaluator의 PARAMS 매칭)와 우측 패널 잘림(react-resizable-panels v4 breaking)을 수정. 동시에 Obsidian MCP로 위키 자동화 기반을 깔았다.

## 무엇이 바뀌었나

- TemplatePicker가 asset 미선택 시 중앙 패널에 노출. 헤더에 "Templates" 복귀 버튼.
- `useStudio` 훅 확장: `initTemplate()`, `clearAsset()`, `CLEAR_ASSET` reducer.
- `evaluator.ts`의 `buildReturnStatement()` PascalCase 필터 추가 (PARAMS 오인식 수정).
- `Panel`의 `defaultSize`/`minSize`를 모두 문자열로 변경 (v4 px↔% 의미 변경 대응).
- `globals.css`에 `[data-panel]`, `[data-panel-group]` overflow 가드 추가.
- Dev 자동 로그인을 Server Action 패턴으로 분리 (`AutoLoginForm.tsx` + `actions.ts`).
- Dev 유저에 `tier: 'PRO'` 자동 설정.
- `iansinnott/obsidian-claude-code-mcp` 설치 + `.mcp.json` SSE(포트 22360) 설정.

## 왜 / 배경

- Studio 첫 진입 시 빈 중앙 패널 문제 → 템플릿 카탈로그를 첫 화면에서 바로 노출.
- v4 마이너 업글에서 prop 타입은 같지만 의미가 바뀌어 레이아웃이 깨짐 → 런타임 동작까지 검증 필요.
- 위키를 Claude Code에서 직접 읽고 쓸 수 있어야 PM/지식베이스 운영이 자동화됨.

## 영향

- 코드: `src/components/studio/*`, `src/hooks/useStudio.ts`, `src/lib/remotion/evaluator.ts`, `src/app/(auth)/*`
- 빌드: ✅ Next.js 16.2.4 / 16 routes, 테스트 19/19, TS 에러 0
- 사용자: 첫 진입 UX 개선, 우측 패널 가시성 회복
- 비용: 변동 없음

## 후속 / 다음

- [ ] 환경변수 실제 키 주입 (Google OAuth, Stripe live, Anthropic, Neon)
- [ ] Vercel 배포 + 도메인 연결
- [ ] Remotion Lambda 프로덕션 셋업
- [ ] A1 검증: 커스터마이징 파라미터 추출 50회 테스트
- [ ] 추가 템플릿 7~17개

## 출처 / 링크

- [[../02-dev/status|개발 현황 (live)]]
- [[../02-dev/tech-notes/2026-04-26-evaluator-params-bug|Tech Note: Evaluator PARAMS 버그]]
- [[../02-dev/tech-notes/2026-04-26-react-resizable-panels-v4-breaking|Tech Note: react-resizable-panels v4]]
- [[../01-pm/roadmap|Roadmap]]
- 원본 빌드 보고서: `../../docs/REPORT.md`

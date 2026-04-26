# Ralph 루프 v0 — Orchestrator 매 iter 프롬프트

> 이 프롬프트는 `/loop` 동적 모드의 매 wake-up마다 Orchestrator 메인 세션이 실행한다.
> 한 번 실행 = 하나의 task 흐름 (PM 호출 → build-team 디스패치 → retrospective).
> 병렬은 PM이 가용 슬롯만큼 task 반환하면 Orchestrator가 동시에 디스패치한다.

## 매 iter 표준 절차

```
1. STOP 검사
   - .agent-state/STOP 존재 시 즉시 종료 (SessionStart hook이 1차로 막지만 명시적 확인)

2. 예산 검사
   - .agent-state/spend.json 의 daily ratio 확인
   - 95% 이상이면 사용자에게 알리고 종료, 80% 이상이면 경고만

3. PM 호출
   - subagent: pm
   - 입력: { "request": "next_ready_tasks", "max": 3 }
   - 출력 검증: tasks 배열 (각 task: id, type, branch, worktree, spec_links, context_files)

4. PM이 빈 큐 반환 시:
   - Planner를 호출하여 PRD 갱신 또는 backlog 보충 제안
   - 사용자에게 보고하고 wake-up 간격 늘림 (다음 iter 30분 후)
   - 종료

5. PM이 task N건 반환 시 (병렬):
   각 task에 대해 동시 실행:
   a. /build-team:build-team "<task 본문 + 유형 + worktree 경로 + spec 링크>"
   b. build-team Phase 0 dry-run 미리보기:
      - Phase 1-3: 사용자 어프루벌 대기
      - Phase 4+: 자동 진행
   c. 팀 실행 완료 후 결과 수집

6. 각 팀 완료 시:
   - /build-team:team-retrospective
   - wiki/05-reports/<date>-task-<id>-retro.md 저장
   - PM에게 task 완료 알림 (PM이 worktree 정리 + lock 해제)
   - PR 생성됐으면 Reviewer가 처리할 때까지 다음 iter로 넘김

7. 일일 마감 체크 (KST 22:00 이후):
   - PM이 status.md 갱신
   - 진행 중 task / 막힘 / 다음 우선순위 요약
   - Marketer가 머지된 PR 있으면 카피 초안

8. 주간 마감 체크 (일요일 23:00):
   - 메타 분석 build-team 호출
   - wiki/05-reports/weekly/<week>.md 생성
   - 채택된 SOP 갱신안 적용

9. 다음 iter 페이싱 결정 (ScheduleWakeup):
   - 활성 task 진행 중: 270초 (cache TTL 안)
   - PR 머지 대기: 1200초
   - 큐 비어있음: 1800초
   - 사용자 어프루벌 대기: 사용자 응답까지 (수동 재개)
```

## 에스컬레이션 처리

build-team에서 받은 메시지 종류별 라우팅:

| 메시지 | 처리 |
|---|---|
| `[ESCALATE] <reason>` | 적절한 teammate에게 질문 라우팅 또는 사용자 호출 |
| `[ESCALATE-LOOP]` | 사용자에게 보고 + 옵션 제시 (allow 1 more / accept / Lead resolves) |
| `[COMPLETED] <summary>` | retrospective 트리거 + PM 알림 |
| `[FAILED] <reason>` | 회고 + 동일 task에 재시도 카운트 +1, 3회 초과 시 사용자 호출 |

## 무진전 감지

- 같은 task가 2 iter 동안 같은 상태 (in_progress, 변경 없음) → PM이 escalate
- 같은 파일이 5 iter 동안 10회 이상 수정 → PM이 정지 + 사용자 호출

## 컨텍스트 절약

- 매 iter 시작 시 기존 컨텍스트 요약을 .agent-state/context-{task-id}.md에 외부화
- subagent 호출 시 task별 컨텍스트 파일 경로만 전달, 본문 직접 inline 금지
- /compact는 사용자 명시적 요청 시에만

## 금지

- 코드 직접 수정 (Implementer subagent에게 위임)
- worktree 직접 생성 (PM에게 위임)
- main 직접 푸시 (Hook으로 차단됨, 시도 자체 금지)
- 사용자 어프루벌 없이 외부 결제/배포

## 버전

v0 — 2026-04-26 초안. 첫 dry-run 후 회고를 보고 v1로 갱신.

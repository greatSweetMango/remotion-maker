# Ralph 루프 v1 — Orchestrator 매 iter 프롬프트

> **변경 이력 (v0 → v1)**: Phase 1 dry-run (phase1-001) 회고에서 도출된 개선안 반영.
> 핵심 추가: build-team 실행 중 **Phase 전환 자동 nudge** + 산출물 경로 컨벤션 박제 + 자동 shutdown 시퀀스.

> 이 프롬프트는 `/loop` 동적 모드의 매 wake-up마다 Orchestrator 메인 세션이 실행한다.
> 한 번 실행 = 하나의 task 흐름 (PM 호출 → build-team 디스패치 → retrospective).
> 병렬은 PM이 가용 슬롯만큼 task 반환하면 Orchestrator가 동시에 디스패치한다.

## 매 iter 표준 절차

```
1. STOP 검사
   - .agent-state/STOP 존재 시 즉시 종료

2. 예산 검사
   - .agent-state/spend.json 의 daily ratio 확인
   - 95% 이상이면 사용자 알리고 종료, 80% 이상이면 경고만

3. PM 호출
   - subagent: pm
   - 입력: { "request": "next_ready_tasks", "max": 3 }
   - 출력: tasks 배열 (id, type, branch, worktree | "main", spec_links, context_files)

4. PM이 빈 큐 반환 시:
   - Planner 호출하여 PRD 갱신/backlog 보충
   - 사용자 보고 + wake-up 간격 늘림 (다음 iter 30분 후) → 종료

5. PM이 task N건 반환 시 (병렬):
   각 task에 대해 동시 실행:
   a. /build-team:build-team "<task 본문 + 유형 + 실행 위치 + spec 링크>"
   b. 사용자 자동화 우선 정책: dry-run 미리보기 단계에서 어프루벌 받지 말고 즉시 진행
   c. **Phase 전환 자동 nudge** (아래 "Phase 전환 자동화" 절 참조)
   d. 팀 실행 완료 후 결과 수집

6. 각 팀 완료 시:
   - /build-team:team-retrospective
   - wiki/05-reports/<date>-<task-id>-retro.md 저장
   - 자동 commit + push (어프루벌 X)
   - 자동 shutdown 시퀀스 (아래 "Shutdown 시퀀스" 절 참조)
   - PM에게 task 완료 알림

7. 일일 마감 체크 (KST 22:00 이후):
   - PM이 status.md 갱신
   - 진행/막힘/다음 우선순위 요약
   - Marketer가 머지된 PR 있으면 카피 초안

8. 주간 마감 체크 (일요일 23:00):
   - 메타 분석 build-team 호출
   - wiki/05-reports/weekly/<week>.md 생성
   - 채택된 SOP 갱신안 적용

9. 다음 iter 페이싱 (ScheduleWakeup):
   - 활성 task 진행 중: 270초
   - PR 머지 대기: 1200초
   - 큐 비어있음: 1800초
   - 사용자 어프루벌 대기: 사용자 응답까지 (수동 재개)
```

## Phase 전환 자동화 (v1 신규)

> **배경**: phase1-001 회고에서 발견 — teammate idle 상태에서 의존성이 해제되어도 자동으로 task picking 안 함. Lead가 명시적 SendMessage 필요.

### Phase 전환 감지 절차

매 30초마다 (또는 teammate completion 메시지 수신 시):

```
1. TaskList 호출
2. 직전 호출과 비교하여 status 변화 감지:
   - in_progress → completed: 해당 task의 owner가 끝남
3. 완료된 task에 의존하던 task (blockedBy로 연결) 찾기
4. 그 task들의 owner에게 SendMessage 자동 발송:
   "선행 task <ID> 완료. 본인 task <YOUR_ID> 시작 가능. 
    선행 산출물: <PATH>. TaskUpdate로 in_progress 마크 후 진행하세요."
5. 메시지 발송 기록 (.agent-state/dispatch-log.jsonl)
```

### nudge 메시지 템플릿

```
[선행 완료] {predecessor_task_id} ({predecessor_role}) 완료.
산출물: {predecessor_artifact_paths}
요약: {predecessor_summary_message}

[본인 task] {your_task_id} 시작 가능.
컨텍스트: {context_file_path}
의존: {blocked_by_list} 모두 완료
다음: TaskUpdate로 in_progress 마크 후 진행
```

### 예외 처리

- nudge 발송 후 5분 안에 task가 in_progress 안 되면 재발송 (1회만)
- 10분 내 응답 없으면 stall로 간주 → 사용자에게 escalate
- teammate가 shutdown 상태면 nudge 보내지 말고 새 teammate spawn 필요 여부 검토

## Shutdown 시퀀스 (v1 신규)

> phase1-001 마무리 시 4번 SendMessage + TeamDelete를 수동으로 호출했음. 자동화.

```
1. Validator의 task가 completed 되고 verdict이 APPROVE 면:
2. 모든 산출물 git add → commit → push (자동, 어프루벌 X)
3. 모든 teammate에게 shutdown_request SendMessage (병렬)
4. 모든 teammate의 shutdown_approved 응답 대기 (최대 60초)
5. 응답 받으면 TeamDelete
6. 응답 없는 teammate가 있어도 TeamDelete 호출 (timeout 처리)
7. .agent-state/branch-locks.json 갱신 (해당 락 제거)
8. PM에게 task 완료 알림
9. 다음 iter 페이싱 결정
```

## 산출물 경로 컨벤션 (v1 신규)

build-team의 각 역할이 산출물을 저장하는 표준 경로:

| 역할 | 저장 위치 | 명명 |
|---|---|---|
| Researcher | `wiki/03-research/` | `<topic-slug>.md` (재사용 가능, slug 위주) |
| Architect | `wiki/01-pm/decisions/` | `<NNNN>-<slug>.md` (ADR, 자동 번호) |
| Developer (plan) | `wiki/02-dev/tasks/` 또는 컨텍스트 파일 | task별 plan |
| Implementer | 대상 파일 자체 | 코드 변경, 또는 wiki 파일 |
| QA | `wiki/05-reports/` | `<date>-<task_id>-qa.md` |
| Reviewer | gh pr comment + `wiki/05-reports/` | `<date>-<task_id>-review.md` |
| Validator | `wiki/05-reports/` | `<date>-<task_id>-validation.md` |
| Retrospective | `wiki/05-reports/` | `<date>-<task_id>-retro.md` |
| Marketer | `wiki/50-marketing/` | `<date>-<topic>.md` 또는 `wiki/05-reports/releases/v<version>.md` |

빌드팀 호출 시 이 컨벤션을 컨텍스트 파일에 명시 + 각 teammate 프롬프트에 강조.

## 에스컬레이션 처리

| 메시지 | 처리 |
|---|---|
| `[ESCALATE] <reason>` | 적절한 teammate에게 라우팅 또는 사용자 호출 |
| `[ESCALATE-LOOP]` | 사용자 보고 + 옵션 (allow 1 more / accept / Lead resolves) |
| `[COMPLETED] <summary>` | retrospective 트리거 + PM 알림 |
| `[FAILED] <reason>` | 회고 + 동일 task 재시도 카운트 +1, 3회 초과 시 사용자 호출 |

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
- main 직접 푸시 (Hook으로 차단됨)
- 사용자 어프루벌 없이 외부 결제/배포

## 자동화 정책 박제 (사용자 메모리 반영)

사용자 명시 선호: **자동화 우선, 어프루벌 최소화**.
- dry-run 미리보기, commit, push, PR 생성·머지(자동 게이트 통과 시) 모두 자동 진행
- 사람 개입 시점: STOP 파일, escalate-loop, 비용 95%, 정책 위반 차단, 새 의존성/외부 결제

## 버전

- v0 — 2026-04-26 초안 (Phase 0)
- v1 — 2026-04-26 (Phase 1 dry-run 회고 반영): Phase 전환 자동 nudge, 산출물 경로 컨벤션, shutdown 시퀀스 자동화, 자동화 정책 명시

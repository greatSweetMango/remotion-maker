# launchd 등록 — 메타 분석 cron

본 디렉토리의 plist 파일은 macOS launchd 템플릿입니다. 사용자가 **수동 등록**합니다 (TM-26 자동 등록 X — 사용자 머신 의존).

## 1. 경로 치환

`__REPO_ROOT__`를 절대경로로 치환:

```bash
REPO_ROOT="/Users/kimjaehyuk/Desktop/remotion-maker"
mkdir -p ~/Library/LaunchAgents

for f in com.easymake.meta-analysis-weekly.plist com.easymake.meta-analysis-monthly.plist; do
  sed "s|__REPO_ROOT__|${REPO_ROOT}|g" \
    "${REPO_ROOT}/scripts/launchd/${f}" \
    > "${HOME}/Library/LaunchAgents/${f}"
done
```

## 2. 로드

```bash
launchctl load -w ~/Library/LaunchAgents/com.easymake.meta-analysis-weekly.plist
launchctl load -w ~/Library/LaunchAgents/com.easymake.meta-analysis-monthly.plist
```

## 3. 확인

```bash
launchctl list | grep com.easymake
```

## 4. 수동 트리거 (테스트)

```bash
launchctl start com.easymake.meta-analysis-weekly
tail -f .agent-state/meta-analysis-logs/launchd.log
```

또는 직접 스크립트:

```bash
cd "$REPO_ROOT"
./scripts/meta-analysis.sh weekly --force
```

## 5. 해제

```bash
launchctl unload ~/Library/LaunchAgents/com.easymake.meta-analysis-weekly.plist
launchctl unload ~/Library/LaunchAgents/com.easymake.meta-analysis-monthly.plist
```

## 일정

| 작업 | 트리거 | 비고 |
|---|---|---|
| Weekly | 매주 일요일 23:59 (로컬) | 직전 7일 분석 |
| Monthly | 매월 마지막 날 23:59 (로컬) | 28-31일 모두 트리거하되 셸에서 "내일이 다음 달"인 날만 실행 |

## 동작 흐름

```
launchd 트리거
  → cd $REPO_ROOT
  → git fetch + checkout main + pull --ff-only   (wiki = main 단독 소유)
  → ./scripts/meta-analysis.sh <period>
      → claude -p (prompts/meta-analyzer.md 주입)
      → wiki/05-reports/<period>/<label>.md 생성
      → git add + commit "report: meta-analysis <period> <label>"
  → 로그 .agent-state/meta-analysis-logs/launchd.log
```

## 폭주 방지

- `meta-analysis.sh`는 동일 라벨 파일이 이미 있으면 `--force` 없이 abort
- claude CLI 미발견 시 schema-only stub 생성 (CI/dry-run 호환)
- main 브랜치가 아니면 WARN 출력 (강제 abort는 X — 수동 테스트 허용)

## 트러블슈팅

| 증상 | 원인 / 조치 |
|---|---|
| `launchctl list`에 안 보임 | plist syntax 오류 → `plutil -lint <plist>` |
| 실행 안 됨 | 사용자 로그아웃 시 LaunchAgent는 실행 안 됨. 24/7 필요 시 LaunchDaemon 검토 |
| `claude: command not found` | plist `EnvironmentVariables.PATH`에 claude 경로 추가 |
| git pull 충돌 | 사람이 main에 작업 중 → 다음 트리거에 자동 재시도 |

## 관련 문서

- `prompts/meta-analyzer.md` — 메타 분석 agent 프롬프트
- `scripts/meta-analysis.sh` — 진입점
- `wiki/02-dev/agent-company-blueprint.md` §7 — 리포트 시스템

# EasyMake Wiki

이 디렉토리는 EasyMake 프로젝트의 **LLM 위키 + PM 워크스페이스**입니다.
Obsidian으로 열어서 사용하세요. 평범한 Markdown 파일이라 Git으로 그대로 추적됩니다.

## 빠른 시작

1. Obsidian 설치 → "폴더를 보관소로 열기" → 이 `wiki/` 디렉토리 선택
2. 추천 플러그인 설치 (Settings → Community plugins):
   - **Tasks** — 작업 추적/쿼리
   - **Dataview** — 메타데이터 기반 동적 대시보드
   - **Kanban** — 칸반 보드 (md로 저장됨)
   - **Templater** — 템플릿 자동화
   - **Periodic Notes** — 일일/주간 노트
   - **Smart Connections** — 시맨틱 검색 (관련 노트 자동 추천)
3. (선택) **Claude Code MCP**: `iansinnott/obsidian-claude-code-mcp` 플러그인을 설치하면 Claude Code에서 vault에 직접 읽고 쓸 수 있음
4. 첫 진입은 [[index]] 페이지부터

## 폴더 구조

```
wiki/
├── CLAUDE.md              # 에이전트(Claude Code) 표준 지침
├── index.md               # vault 홈 (여기서 시작)
├── 00-inbox/              # 떠오르는 아이디어/메모를 즉시 던지는 곳
├── 01-pm/                 # 제품/프로젝트 관리 문서
│   ├── overview.md
│   ├── roadmap.md
│   ├── decisions/         # ADR (Architecture Decision Records)
│   └── meetings/          # 회의록
├── 02-dev/                # 개발 현황, 기술 노트
│   ├── status.md          # 현재 개발 상태 (자동/수동 갱신)
│   ├── architecture.md
│   ├── tasks/             # Tasks 플러그인용 마스터 파일
│   └── tech-notes/        # 트러블슈팅, 결정사항, 학습 노트
├── 03-research/           # 경쟁사 분석, 리서치, 레퍼런스
├── 04-archive/            # 더 이상 액티브하지 않은 문서
├── 05-reports/            # 세션/주간/릴리스 보고 — 우선해서 읽는 곳
├── raw/                   # LLM 위키 ingest 인박스 (URL/원문 던지는 곳)
└── _meta/
    ├── taxonomy.md        # 정규화된 태그 사전
    └── templates/         # Templater용 템플릿 파일
```

## 핵심 원칙

- **Single source of truth**: 같은 정보를 두 곳에 두지 않는다. 한 곳에 두고 [[링크]]
- **Inbox → 분류**: 빠르게 던지고 나중에 정리. `/process-inbox` 명령으로 LLM이 분류
- **결정은 ADR로**: 왜 그렇게 했는지는 코드만 봐서는 모른다. `01-pm/decisions/`에 남긴다
- **태그는 `_meta/taxonomy.md`에 정의된 것만 사용**

## LLM 활용 패턴

- `/ingest <url>` — URL을 raw/에 저장하고 위키 페이지로 합성
- `/process-inbox` — 00-inbox 항목을 분류해 적절한 폴더로 이동·링크
- `/lint-wiki` — 깨진 링크, 고아 페이지, 모순 탐지
- `/weekly-status` — 02-dev/status.md를 최근 변경사항 기반으로 갱신

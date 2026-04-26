---
title: Tasks
created: 2026-04-26
updated: 2026-04-26
tags: [meta, dev]
status: active
---

# Tasks

Tasks 플러그인 + Dataview 기반 작업 추적.

## 모든 미완료 태스크 (전체 vault)

```tasks
not done
sort by due
```

## 이번 주 마감

```tasks
not done
due before in 7 days
sort by priority
```

## 개발 영역만

```tasks
not done
path includes 02-dev
```

## 새 태스크 작성법

어떤 페이지든 본문에 다음과 같이 적으면 자동 인덱싱:

```
- [ ] Lambda 환경변수 셋업 🔼 📅 2026-05-01 #area/infra
- [ ] 템플릿 5개 추가 📅 2026-05-10 #area/templates
```

기호: `🔼` 높은 우선순위, `📅` 마감일, `🔁` 반복, `#` 태그.

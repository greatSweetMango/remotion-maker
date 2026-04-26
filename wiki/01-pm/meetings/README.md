---
title: Meetings
created: 2026-04-26
updated: 2026-04-26
tags: [meta]
status: active
---

# 회의록

## 규칙

- 파일명: `YYYY-MM-DD-주제-slug.md`
- 템플릿: `_meta/templates/meeting.md`
- 액션 아이템은 `- [ ] 할일 @담당자 📅 YYYY-MM-DD` 형식 (Tasks 플러그인 호환)
- 결정사항이 ADR 급이면 `01-pm/decisions/`에 별도로 만들고 회의록에서 링크

## 인덱스 (Dataview)

```dataview
TABLE created as "Date", tags
FROM "01-pm/meetings"
WHERE file.name != "README"
SORT created DESC
```

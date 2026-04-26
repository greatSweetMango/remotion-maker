---
title: Raw Sources
created: 2026-04-26
updated: 2026-04-26
tags: [meta]
status: active
---

# 📦 Raw Sources

LLM 위키 ingest 인박스. URL 본문, 스크린샷, 외부 자료 원문을 그대로 저장하는 곳.

## 규칙

- 파일명: `YYYY-MM-DD-domain-slug.md`
- 첫 줄에 출처 URL을 frontmatter나 본문 맨 위에 명시
- 정제된 인사이트는 `03-research/`에 별도 작성. 여기는 **불변의 원본**.

## 사용

`/ingest <url>` 커맨드로 자동 저장 + `03-research/`에 합성 페이지 생성.

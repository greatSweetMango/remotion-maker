---
title: react-resizable-panels v4 — 숫자/문자열 size 의미 변경
created: 2026-04-26
updated: 2026-04-26
tags: [dev, tech-note]
status: active
---

# react-resizable-panels v4: `defaultSize` 단위 breaking change

## 증상

Studio 우측 패널이 화면 밖으로 밀려나서 잘리는 현상. CSS overflow 설정으로 해결되지 않음.

## 원인

`react-resizable-panels` v4부터 `Panel`의 `defaultSize` / `minSize` / `maxSize` 의 값 해석이 바뀜:

- **숫자(`{52}`)** → **픽셀(px)** 단위
- **문자열(`"52"`)** → **퍼센트(%)** 단위

기존 코드는 v3 기준으로 `defaultSize={52}` 같이 작성되어 있었고, v4에서는 이게 "52px"로 해석되어 패널이 극단적으로 좁아지거나 합산이 100%를 초과하는 현상이 생김.

## 수정

`src/components/studio/Studio.tsx`의 모든 `Panel`을 문자열 값으로 변경:

```tsx
// Before
<Panel defaultSize={52} minSize={35}>

// After
<Panel defaultSize="52" minSize="35">
```

## 교훈

라이브러리 메이저 업데이트 시 prop 타입 의미가 바뀌는 경우가 있음 — 타입은 통과해도 런타임 동작이 달라짐. `node_modules/react-resizable-panels/CHANGELOG.md` 또는 GitHub releases 확인 필요.

## 관련

- 코드: `../src/components/studio/Studio.tsx`
- CSS 보강: `../src/app/globals.css` (`[data-panel]` 셀렉터)

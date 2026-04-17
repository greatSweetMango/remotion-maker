# PRD — EasyMake: Animate anything, your way

> **Product Requirements Document v1.0**
> 작성일: 2026-04-17 | 상태: Draft | 작성자: 이지메이크 창업팀

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Problem Statement](#2-problem-statement)
3. [Target Users & Personas](#3-target-users--personas)
4. [Core Value Proposition](#4-core-value-proposition)
5. [Feature Requirements](#5-feature-requirements)
   - 5.1 [AI 에셋 생성](#51-ai-에셋-생성)
   - 5.2 [동적 커스터마이징 UI](#52-동적-커스터마이징-ui)
   - 5.3 [편집 요청 (Re-prompt)](#53-편집-요청-re-prompt)
   - 5.4 [Export 시스템](#54-export-시스템)
   - 5.5 [템플릿 갤러리](#55-템플릿-갤러리)
   - 5.6 [인증 & 계정 관리](#56-인증--계정-관리)
   - 5.7 [구독 & 결제](#57-구독--결제)
6. [Non-Functional Requirements](#6-non-functional-requirements)
7. [Technical Architecture](#7-technical-architecture)
8. [Pricing & Business Model](#8-pricing--business-model)
9. [MVP Scope](#9-mvp-scope)
10. [Success Metrics](#10-success-metrics)
11. [Assumptions & Risks](#11-assumptions--risks)
12. [Out of Scope (v1)](#12-out-of-scope-v1)

---

## 1. Product Overview

**서비스명:** EasyMake (이지메이크)
**슬로건:** *Animate anything, your way*
**서비스 유형:** AI 기반 모션 에셋 생성 SaaS (글로벌)

EasyMake는 Remotion(React 기반 영상 프레임워크)을 활용해 웹에서 AI로 모션 에셋을 생성하고, 동적으로 커스터마이징할 수 있는 UI를 자동 제공하는 서비스다. 유저는 프롬프트로 에셋을 만들고, 생성 직후 슬라이더·컬러피커 등의 UI로 즉각 조정해 원하는 결과물을 얻는다.

**핵심 아이디어:** AI가 만들고, 내가 완성한다.

---

## 2. Problem Statement

### 현재 시장의 문제

| 문제 | 영향받는 유저 |
|---|---|
| AI 생성 에셋이 의도와 달라도 수정이 불편하다 | 모든 AI 창작 도구 사용자 |
| After Effects 등 전문 툴은 러닝커브가 너무 높다 | 비전문 디자이너, 회사원 |
| LottieFiles/Canva는 디테일한 커스터마이징이 안 된다 | 정교함을 원하는 디자이너 |
| 프론트 개발자가 바로 embed 가능한 모션 컴포넌트 소스가 없다 | 프론트엔드 개발자 |

### 현재 AI 창작 도구의 루프 문제

```
AI 생성 → 결과물이 기대와 다름 → 재프롬프트 → 또 다름 → 반복 → 포기
```

EasyMake가 제공하는 루프:

```
AI 생성 → 커스터마이징 UI로 즉시 직접 조작 → 원하는 결과 → Export
```

---

## 3. Target Users & Personas

### Primary Target (MVP)

**Persona 1 — 모션 디자이너 "지현"**
- 연령: 27세, 프리랜서 모션 그래픽 디자이너
- 현재 도구: After Effects + LottieFiles
- 고통: 클라이언트 요청마다 에셋을 처음부터 만들어야 함. AI 생성 결과물은 퀄리티가 들쑥날쑥해서 믿기 어렵다.
- 원하는 것: "AI가 초안을 만들어주고 내가 세부 조정만 하면 되는 워크플로우"

**Persona 2 — 프론트엔드 개발자 "재혁"**
- 연령: 30세, 스타트업 개발자
- 현재 도구: CSS Animation, Lottie JSON 직접 작성
- 고통: 모션 에셋을 직접 만드는 시간 낭비. 디자이너에게 요청하면 납기가 느리다.
- 원하는 것: "React 컴포넌트로 바로 import 가능한 모션 에셋"

### Secondary Target (성장 후)

- PPT 만드는 회사원: 발표자료에 쓸 카운터·차트 애니메이션 필요
- 영상 편집자: 투명 배경 WebM, ProRes 포맷의 모션 에셋 필요
- SNS 콘텐츠 제작자: 눈길을 끄는 움직이는 에셋 제작

---

## 4. Core Value Proposition

### 경쟁 서비스 대비 차별점

| 기능 | LottieFiles AI | Jitter | Rive | **EasyMake** |
|---|---|---|---|---|
| AI 코드 생성 | ✓ | ✗ | ✗ | ✓ |
| 동적 커스터마이징 UI 자동 생성 | ✗ | ✗ | ✗ | **✓ (유일)** |
| React 컴포넌트 export | ✗ | ✗ | ✗ | **✓ (유일)** |
| 투명채널 WebM export | ✗ | △ | ✗ | ✓ |
| 드래그 영역 편집 요청 | ✗ | ✗ | ✗ | ✓ |
| 웹 Player embed | ✗ | ✗ | ✓ | ✓ |

### 핵심 해자 (Unfair Advantage)

1. **동적 커스터마이징 UI 자동 생성** — 에셋 생성 시 파라미터를 자동 추출해 슬라이더/컬러피커 UI로 제공. 현재 어떤 경쟁사도 하지 않는 기능.
2. **React 컴포넌트 export** — 프론트엔드 개발자 타깃으로 코드 레벨 export 제공.
3. **편집 ≠ 렌더 아키텍처** — 편집 요청 시 LLM이 코드만 수정하고 브라우저 Player에서 즉시 재생. 원가 절감 + 즉각적인 UX 동시 달성.

---

## 5. Feature Requirements

### 5.1 AI 에셋 생성

#### 기능 설명

유저가 텍스트 프롬프트를 입력하면 AI가 Remotion 기반 React 컴포넌트 코드를 생성하고, 브라우저의 Remotion Player에서 즉시 재생한다.

#### 요구사항

| ID | 요구사항 | 우선순위 |
|---|---|---|
| GEN-01 | 텍스트 프롬프트 입력으로 Remotion 컴포넌트 코드 생성 | P0 |
| GEN-02 | 생성된 에셋을 브라우저 Player에서 즉시 재생 (렌더링 없이) | P0 |
| GEN-03 | 생성 시 커스터마이징 파라미터를 고려한 코드 생성 (시스템 프롬프트 강제) | P0 |
| GEN-04 | 생성 모델 등급 선택 (Quick / Creative / Pro) | P1 |
| GEN-05 | 특정 영역 드래그 후 해당 영역 집중 편집 요청 | P2 |
| GEN-06 | AI가 역질문을 통해 유저 니즈를 구체화하는 인터랙션 | P2 |

#### 지원 에셋 유형 (MVP)

- 카운터/숫자 애니메이션
- 효과 텍스트 (만화 타격감, 강조 효과)
- 차트 애니메이션 (2D/3D-like)
- 모션 그래픽
- 그라디언트 Blob 배경
- 로고 리빌 애니메이션
- 자막/텍스트 에셋

#### AI 모델 등급

| 등급 | 유저 표시명 | 내부 모델 | 원가/회 | 비고 |
|---|---|---|---|---|
| 경량 | Quick | Claude Haiku 4.5 | ~$0.006 | Free 티어 |
| 표준 | Creative | Claude Sonnet 4.6 | ~$0.018 | Pro 티어 |
| 고급 | Pro | Sonnet 4.6 + Extended Thinking | ~$0.04~0.06 | Team 티어 |

> **Note:** Premium 등급 대안으로 AI 에이전트 워크플로우(multi-step reasoning pipeline) 직접 구축 검토 중 (추후 연구 필요)

---

### 5.2 동적 커스터마이징 UI

#### 기능 설명

AI가 에셋을 생성할 때 조절 가능한 파라미터(색상, 속도, 크기, 텍스트 등)를 자동으로 추출해 적절한 UI 컴포넌트로 제공한다.

#### 요구사항

| ID | 요구사항 | 우선순위 |
|---|---|---|
| UI-01 | 에셋 생성 후 커스터마이징 파라미터 자동 추출 및 UI 패널 표시 | P0 |
| UI-02 | 파라미터 타입에 따른 적절한 UI 컴포넌트 자동 매핑 | P0 |
| UI-03 | 비슷한 범주끼리 그룹핑 (색상, 크기/위치, 타이밍, 텍스트) | P0 |
| UI-04 | UI 조작 시 Remotion Player 실시간 반영 (렌더 없음, $0) | P0 |
| UI-05 | Free 티어: 기본 3개 파라미터만 활성화, 나머지 잠금 | P1 |
| UI-06 | 특정 요소 클릭 시 해당 요소의 커스터마이징 UI 요청 | P2 |
| UI-07 | "이 부분을 커스터마이징하고 싶어요" 자연어 요청으로 추가 UI 생성 | P2 |

#### 파라미터 → UI 매핑 규칙

```
색상값 (hex, rgb)       → ColorPicker (shadcn ColorPicker)
0.0 ~ 1.0 범위         → Slider (0~100%)
px/rem 크기값           → Slider + 숫자 입력
텍스트 콘텐츠            → TextInput
Boolean 값              → Switch
선택지 배열              → Select / RadioGroup
숫자 (frame, duration)  → NumberInput + Slider
```

---

### 5.3 편집 요청 (Re-prompt)

#### 기능 설명

생성된 에셋에 대해 추가 자연어 요청으로 코드를 수정한다. 편집은 코드 레벨에서만 이루어지며 렌더링은 발생하지 않는다.

#### 요구사항

| ID | 요구사항 | 우선순위 |
|---|---|---|
| RP-01 | 채팅 인터페이스로 편집 요청 입력 | P0 |
| RP-02 | LLM이 기존 코드 + 요청을 받아 수정된 코드만 반환 (렌더 없음) | P0 |
| RP-03 | 편집 이력 (히스토리) 관리 — 이전 버전으로 되돌리기 | P1 |
| RP-04 | Free 티어: 생성당 편집 3회 제한, 초과 시 Pro 업그레이드 유도 | P1 |
| RP-05 | Pro/Team: 월 200회/500회 포함, 초과 시 크레딧 차감 | P1 |
| RP-06 | 편집 요청 vs 새 생성 명확 구분 UX ("새로 만들기" vs "수정하기") | P1 |

#### 편집 요청 원가 최적화

- 시스템 프롬프트 + 기존 코드는 프롬프트 캐싱 적용 → 입력 토큰 비용 90% 절감
- 실효 원가: Creative 기준 편집 1회 ~$0.007

---

### 5.4 Export 시스템

#### 기능 설명

완성된 에셋을 다양한 포맷으로 다운로드한다. Export 시에만 서버 렌더링(AWS Lambda)이 발생한다.

#### 요구사항

| ID | 요구사항 | 우선순위 |
|---|---|---|
| EXP-01 | 웹 Player embed 코드 복사 (렌더 없음, 전체 무료) | P0 |
| EXP-02 | GIF export (저해상도, Free 워터마크 포함) | P0 |
| EXP-03 | MP4 1080p export (Pro 이상) | P0 |
| EXP-04 | WebM 투명채널 export (Pro 이상, 디자이너 핵심 수요) | P1 |
| EXP-05 | PNG 시퀀스 export (Pro 이상) | P1 |
| EXP-06 | React 컴포넌트 코드 export (Pro, 렌더 없음) | P1 |
| EXP-07 | ProRes / 4K export (Team 이상) | P2 |
| EXP-08 | Export 포맷을 페르소나별로 그룹핑해서 표시 | P1 |

#### Export 포맷별 원가 및 티어

| 포맷 | 원가/회 | 제공 티어 |
|---|---|---|
| 웹 embed | $0 | 전체 (무료) |
| GIF 저해상도 | ~$0.015 | Free (워터마크) |
| MP4 1080p | ~$0.02 | Pro |
| WebM 투명채널 | ~$0.025 | Pro |
| PNG 시퀀스 | ~$0.03~0.05 | Pro |
| React 컴포넌트 | $0 | Pro |
| ProRes / 4K | ~$0.05+ | Team |

#### Export 페르소나별 그룹핑 UX

```
웹 개발자 탭: Web embed, React 컴포넌트
디자이너 탭:  WebM 투명채널, PNG 시퀀스, ProRes
일반 유저 탭: GIF, MP4, Web embed
```

---

### 5.5 템플릿 갤러리

#### 기능 설명

미리 제작된 템플릿을 갤러리 형태로 제공해 유저 진입장벽을 낮추고, 서비스 기능을 시각적으로 보여준다.

#### 요구사항

| ID | 요구사항 | 우선순위 |
|---|---|---|
| TMP-01 | 템플릿 갤러리 페이지 (랜딩 겸용, SEO 최적화) | P0 |
| TMP-02 | 템플릿 클릭 시 즉시 Player에서 재생 + 커스터마이징 UI 표시 | P0 |
| TMP-03 | 유저가 템플릿 기반으로 프롬프트 수정 요청 가능 | P0 |
| TMP-04 | MVP: 직접 제작 템플릿 10~20개 (후킹용 3개 우선) | P0 |
| TMP-05 | 카테고리별 필터 (차트, 텍스트, 배경, 모션 등) | P1 |
| TMP-06 | 템플릿 SEO 랜딩 페이지 (animated chart generator 등) | P1 |

#### 우선 제작 템플릿 3개 (후킹용)

1. **카운터/숫자 애니메이션** — 빠른 WOW 효과, PPT 회사원 즉시 활용 가능
2. **효과 텍스트 (만화 타격감)** — SNS 바이럴 폭발력, 공유율 최고
3. **3D-like 차트 애니메이션** — 전문성 증명, 데이터 바인딩 예시

---

### 5.6 인증 & 계정 관리

#### 요구사항

| ID | 요구사항 | 우선순위 |
|---|---|---|
| AUTH-01 | Google OAuth 소셜 로그인 | P0 |
| AUTH-02 | 이메일/패스워드 가입 | P0 |
| AUTH-03 | 내 에셋 히스토리 조회 | P1 |
| AUTH-04 | 사용량 대시보드 (남은 생성 횟수, 크레딧 잔액) | P1 |
| AUTH-05 | 구독 관리 (업그레이드/다운그레이드/취소) | P1 |

---

### 5.7 구독 & 결제

#### 요구사항

| ID | 요구사항 | 우선순위 |
|---|---|---|
| PAY-01 | Stripe 결제 연동 (월/연 구독) | P0 |
| PAY-02 | 추가 크레딧 구매 (한도 초과 시) | P1 |
| PAY-03 | Webhook으로 구독 상태 실시간 동기화 | P0 |
| PAY-04 | 워터마크 자동 삽입/제거 (티어에 따라) | P0 |
| PAY-05 | 구독 만료 시 Free 티어로 자동 다운그레이드 | P1 |

---

## 6. Non-Functional Requirements

### 성능

| 항목 | 목표 |
|---|---|
| 에셋 첫 생성 시간 | 10초 이내 (Creative 기준) |
| 커스터마이징 UI 반응 속도 | 200ms 이내 (렌더 없이 즉시 반영) |
| Player 재생 프레임 | 30fps 이상 (브라우저 기준) |
| Export 완료 시간 (MP4 1080p 10초) | 60초 이내 |
| 페이지 초기 로드 | LCP 2.5초 이내 |

### 안정성

- 월 uptime 99.5% 이상
- Lambda 렌더 실패 시 자동 재시도 (최대 3회)
- 렌더 실패 시 크레딧 환불 처리

### 보안

- 생성된 코드의 서버 사이드 샌드박스 실행
- 유저 에셋 S3 저장 시 암호화
- API 키 클라이언트 노출 금지

### 접근성

- 글로벌 서비스 → 영어 우선, 다국어 지원 (i18n 구조)
- 모바일 반응형 (모바일에서 갤러리 열람 및 기본 기능 사용 가능)

---

## 7. Technical Architecture

### 기술 스택

| 영역 | 기술 | 선택 이유 |
|---|---|---|
| 프론트엔드 | Next.js 14+ (App Router) + Vercel | 서버/클라이언트 컴포넌트 분리, Edge 배포 |
| UI 컴포넌트 | shadcn/ui + Tailwind CSS | 서버 컴포넌트 호환, AI 코드 생성 시 컨텍스트 활용 유리, Chakra 대비 번들 경량 |
| 데이터베이스 | Prisma + NeonDB (Serverless Postgres) | 서버리스 친화, 개발 생산성 |
| 에셋 저장 | AWS S3 | 렌더 결과물, 유저 에셋 저장 |
| 렌더링 | Remotion Lambda (AWS) | Export 시에만 발생, 원가 최적화 |
| LLM | Anthropic Claude API | Haiku/Sonnet 모델 티어 분리 |
| 결제 | Stripe | 구독 + 크레딧 관리 |
| 인증 | NextAuth.js | Google OAuth + 이메일 |

### 핵심 아키텍처 결정: 편집 ≠ 렌더

```
[편집 요청 플로우]
유저 프롬프트 입력
    → Next.js API Route
    → Claude API (코드 수정만, 렌더 없음)
    → 수정된 Remotion 코드 반환
    → 브라우저 Remotion Player 즉시 재생 ($0)

[Export 플로우]
유저 Export 버튼 클릭
    → 포맷 선택 (GIF/MP4/WebM 등)
    → Remotion Lambda 렌더링 트리거
    → S3에 결과물 저장
    → 다운로드 링크 제공
```

### 커스터마이징 UI 파이프라인

```
[1단계] 코드 생성 시
AI 시스템 프롬프트에 파라미터 명시 강제
→ CSS 변수, props로 모든 커스터마이징 값 추출 가능하게 설계

[2단계] 파라미터 추출
생성된 코드에서 파라미터 타입 자동 분류
→ 색상값, 크기, 속도, 텍스트 등 그룹핑

[3단계] UI 컴포넌트 매핑
파라미터 타입에 따라 shadcn 컴포넌트 자동 선택
→ ColorPicker, Slider, Input, Select 등

[4단계] 실시간 반영
UI 조작 → Remotion Player props 업데이트 → 즉시 재생
(렌더링 없음, $0)
```

---

## 8. Pricing & Business Model

### 구독 티어

| 기능 | Free | Pro ($12/mo) | Team ($25/mo/seat) |
|---|---|---|---|
| 월 생성 횟수 | 3회 | 200회 | 500회 |
| 편집 요청 | 생성당 3회 | 무제한 | 무제한 |
| AI 모델 | Quick only | Quick + Creative | 전 등급 |
| Export 포맷 | GIF (워터마크) | 전체 포맷 | 전체 + ProRes/4K |
| 커스터마이징 항목 | 기본 3개 | 전체 | 전체 |
| React 컴포넌트 export | ✗ | ✓ | ✓ |
| 템플릿 | 무료 템플릿 | 전체 | 전체 |

**초과 사용 (Pro):** 200회 초과 시 크레딧 $0.10/회 추가 구매

### 원가 구조

```
렌더 1회 원가:
  Remotion Automator:  $0.01/render
  AWS Lambda:          $0.002~0.02/render
  LLM (캐싱 적용):    ~$0.007~0.018/call
  합계:                ~$0.019~0.048

Pro 플랜 마진:
  구독료: $12
  원가:   ~$4.36 (Creative 200회 + Export 20회)
  마진:   ~$7.64 (64%)
```

### Remotion 라이선스

- 3인 이하: 무료 (MVP 초기)
- 4인+ / 서비스 상업화: Automators 플랜 — 렌더당 $0.01 + 월 최소 $100

---

## 9. MVP Scope

### MVP 포함 기능 (v1)

- [x] 텍스트 프롬프트 → Remotion 에셋 생성
- [x] 브라우저 Player 즉시 재생
- [x] 동적 커스터마이징 UI 자동 생성 (핵심 기능)
- [x] 편집 요청 (Re-prompt)
- [x] GIF, MP4 export
- [x] React 컴포넌트 export
- [x] 템플릿 갤러리 (직접 제작 10~20개)
- [x] Google OAuth 로그인
- [x] Stripe 구독 결제 (Free / Pro)
- [x] 사용량 대시보드

### MVP 제외 기능 (v2+)

- [ ] 커뮤니티 / 마켓플레이스
- [ ] 유저 간 결제 (사업자 등록 필요)
- [ ] Three.js 3D 에셋
- [ ] 이미지 생성 + 커스터마이징
- [ ] Team 플랜
- [ ] 모바일 앱
- [ ] AI 에이전트 워크플로우 Premium 등급
- [ ] ProRes / 4K export

### MVP 개발 우선순위

```
Week 1-2:  프로젝트 셋업 (Next.js + shadcn + Prisma + NeonDB)
Week 3-4:  Remotion Player 웹 통합 + 기본 코드 생성 파이프라인
Week 5-6:  커스터마이징 UI 파이프라인 (핵심 기능, 검증 필요)
Week 7-8:  편집 요청 (Re-prompt) + 히스토리
Week 9-10: Export 시스템 (Remotion Lambda 연동)
Week 11-12: 인증 + 결제 (Stripe) + 사용량 관리
Week 13-14: 템플릿 갤러리 + 랜딩 페이지
Week 15-16: QA + 성능 최적화 + 베타 테스트
```

---

## 10. Success Metrics

### Launch KPIs (런칭 후 3개월)

| 지표 | 목표 |
|---|---|
| 가입자 수 | 1,000명 |
| Free → Pro 전환율 | 5% 이상 |
| MRR | $600 (50명 × $12) |
| 에셋 생성 횟수 | 월 5,000회 |
| Export 횟수 | 월 1,000회 |

### 제품 품질 지표

| 지표 | 목표 |
|---|---|
| 커스터마이징 UI 파라미터 자동 추출 성공률 | 80% 이상 |
| 편집 1회 후 유저 만족 (재편집 없음) | 60% 이상 |
| 에셋 생성 실패율 | 5% 미만 |
| NPS (Net Promoter Score) | 30 이상 |

### 비용 지표

| 지표 | 목표 |
|---|---|
| 월 AI 원가 / MRR 비율 | 40% 이하 |
| 렌더 실패율 | 2% 미만 |

---

## 11. Assumptions & Risks

### 검증이 필요한 핵심 가정

| # | 가정 | 검증 방법 | 리스크 |
|---|---|---|---|
| A1 | AI가 커스터마이징 파라미터를 일관되게 자동 추출할 수 있다 | 프롬프트 테스트 50회 | **HIGH** — 서비스 핵심 기능 |
| A2 | Sonnet + Extended Thinking이 에셋 품질에서 체감 차이를 만든다 | A/B 테스트 | MEDIUM |
| A3 | 디자이너가 기존 워크플로우 대신 이 서비스로 이전한다 | 인터뷰 + 사용 데이터 | HIGH |
| A4 | Pro $12에서 전환율 5% 달성 가능하다 | 런칭 후 3개월 데이터 | MEDIUM |
| A5 | 워터마크 GIF 바이럴이 실제 유입으로 이어진다 | UTM 추적 | MEDIUM |
| A6 | 브라우저 Player가 복잡한 에셋에서 성능을 유지한다 | 복잡도별 벤치마크 | MEDIUM |

### 기술적 리스크

- **코드 보안:** AI가 생성한 코드에 악의적인 코드가 포함될 수 있음 → 서버 사이드 코드 검증 필수
- **Remotion 라이선스 변경:** 상업화 시 비용 구조 변화 가능 → 계약 선검토 필요
- **LLM API 비용 급등:** AI 비용 증가 시 마진 압박 → 캐싱 최적화 + 모델 라우팅 전략 유지

---

## 12. Out of Scope (v1)

- 커뮤니티 기능 및 유저 간 에셋 공유
- 마켓플레이스 및 유저 간 결제
- Three.js / Unity 연동 3D 에셋
- 이미지 생성 (Stable Diffusion 등)
- 모바일 네이티브 앱
- B2B API 제공
- 화이트라벨 솔루션
- 사운드/오디오 트랙 연동
- 협업 기능 (실시간 공동 편집)

---

> 마지막 업데이트: 2026-04-17
> 다음 리뷰 예정: MVP 첫 스프린트 완료 후 (4주 후)

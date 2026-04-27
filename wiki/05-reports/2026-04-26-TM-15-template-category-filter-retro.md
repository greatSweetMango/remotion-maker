# TM-15 회고 — 템플릿 갤러리 카테고리 필터 (Studio 연결)

- **결과**: PR #14 생성, tests 87/87, lint/tsc clean.
- **핵심 발견**: TM-5에서 이미 FilterBar 컴포넌트 + 템플릿 category 메타 + 랜딩 사용처가 모두 도입됨. TM-15는 사실상 'wire-up only' task로 축소.
- **결정**: 신규 컴포넌트/메타 변경 X. Studio 좌측 TemplatePicker에 동일 패턴(useMemo + 'all' 기본)으로 연결만.
- **Spec vs 구현 갭**: 'Data Viz / Loader' 라벨은 기존 분류(chart/counter/background)와 직접 매칭 어려움. 'Data Viz'→'chart'로 매핑, 'Loader'는 별도 id 없음으로 보류.
- **개선점**: 다음 iter PM이 task 위임 전 'TM-N 결과물 재사용 가능' 라벨 자동 부여하면 build-team 스킵 결정이 더 빨라짐.
- **메트릭**: 1 파일 +27/-7, 회귀 0, 5분 완료.

# 식물왕 (Sikmulwang)

> 내 공간과 계절에 맞는 식물을 찾고, 오늘의 관리를 끝내고, 성장과 수확의 기록을 내 데이터로 남기는 웹/PWA 서비스.

- Repository: https://github.com/nothing2that-sys/sikmulwang
- 문서 상태: **DESIGN_REWORK_DRAFT — 독립 검토 REWORK_REQUIRED, 설계 재작업 및 재검토 전**
- 작성 기준일: 2026-10-14
- 제품 유형: 로컬 우선(Local-first) 반응형 웹 + 점진적 PWA
- 개인 데이터: 기기 내 IndexedDB를 주 저장소로 사용. 별도 식물왕 계정과 중앙 개인 데이터베이스는 기본 범위에서 제외
- 외부 백업: ZIP 내보내기/가져오기 필수, 사용자 승인 후 Google Drive 연동

## 프로젝트의 5가지 약속

1. 로그인 없이 식물 검색과 재배 기록을 시작한다.
2. 홈 화면은 **오늘 해야 할 관리 1~3개**를 먼저 보여준다.
3. 추천과 문제 해결에는 출처, 적용 조건, 불확실성을 표시한다.
4. 물주기 예정일과 실제 물주기 기록을 분리한다. 비가 온다고 실내 식물 물주기를 자동 연기하지 않는다.
5. 일기·사진·관리 이력은 사용자의 자산이다. 내보내기와 복원을 지원한다.

## 문서 읽는 순서

1. [기준 문서와 결정사항](docs/SSOT_INDEX.md)
2. [제품 요구사항](docs/01_PRODUCT_REQUIREMENTS.md)
3. [정보구조와 UX](docs/02_UX_INFORMATION_ARCHITECTURE.md)
4. [시스템 아키텍처](docs/03_SYSTEM_ARCHITECTURE.md)
5. [데이터 모델](docs/04_DATA_MODEL.md)
6. [추천·관리·위험 엔진](docs/05_RULE_ENGINE.md)
7. [로컬 데이터·백업·복원](docs/06_LOCAL_FIRST_BACKUP.md)
8. [농진청·기상청 데이터](docs/07_PUBLIC_DATA_INTEGRATION.md)
9. [보안·접근성·호환성](docs/08_SECURITY_ACCESSIBILITY.md)
10. [구현 로드맵·검증 게이트](docs/09_IMPLEMENTATION_QA.md)
11. [열린 의사결정](docs/10_DECISION_LOG.md)
12. [독립 검토 Rework 게이트](docs/11_DESIGN_REWORK_GATE.md)
13. [로컬 데이터 및 관리 상태 계약](docs/12_DATA_CONTRACT_V1.md)
14. [무손실 백업·복원 프로토콜](docs/13_BACKUP_RESTORE_PROTOCOL.md)
15. [결정적 규칙과 고정 테스트](docs/14_RULES_AND_FIXTURES.md)
16. [요구사항과 테스트 추적표](docs/15_REQUIREMENT_TRACEABILITY.md)

## 기술 기준선 (제안)

- 프런트엔드: React + TypeScript + Vite
- 로컬 데이터: IndexedDB + Dexie, 정형 데이터 스키마 검증
- 스타일: 모바일 우선 디자인 토큰, 접근성 중심 UI
- 백업: 버전이 명시된 ZIP(JSON + 이미지) + SHA-256 검증
- 개인 클라우드: Google Identity Services 및 Google Drive API (`drive.file`) 선택 연동
- 공공 API 연동: 서버리스 중계/캐시. 개인 일기/사진은 보내지 않음
- 검증: 단위 테스트 + 브라우저 E2E + 데이터 복원 회귀 테스트

이 문서들은 구현 전에 검토할 설계 초안이며, 실제 API 데이터 제공 범위·이용허락·운영비는 별도의 검증 게이트를 통과해야 합니다.

## Phase 0 웹 기반

`web/`에 React + TypeScript + Vite 기반 반응형 웹과 PWA 앱 셸을 구현했습니다. 오늘, 식물 찾기, 내 식물, 일기장, 설정 및 데이터 관리 화면을 제공합니다.

```bash
cd web
npm install
npm run dev
```

검증 명령, 오프라인 실행 방법, 미구현 범위는 [웹 실행 안내](web/README.md)와 [Phase 0 구현 보고서](docs/implementation/P0_WEB_FOUNDATION_REPORT.md)를 확인하세요. 기존 설계 승인 상태는 변경하지 않습니다.

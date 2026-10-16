# 식물왕 Phase 0 웹

Node.js 24 LTS와 npm을 기준으로 검증합니다. 저장된 lockfile과 동일한 설치에는 `npm ci`를 사용하세요.

```bash
npm install
npm run dev
npm run lint
npm run typecheck
npm run test
npm run build
npx playwright install --with-deps chromium
npm run test:e2e
```

개발 서버 기본 주소는 `http://127.0.0.1:5173`입니다. `npm run test:e2e`는 프로덕션 빌드(`npm run build`)를 먼저 수행한 뒤, 기존 `4173` 포트 서버를 재사용하지 않고 Vite preview 서버를 새로 실행합니다. 별도 설치된 Chromium을 검증할 때만 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`를 지정할 수 있습니다. CI는 Playwright 기본 Chromium을 사용합니다.

## 화면 및 동작

| 경로 | 제공 기능 |
|---|---|
| `/` | 실제 기록이 없는 빈 상태, 최대 3개 데모 관리 카드 선택 표시 |
| `/discover` | 샘플 이름 검색, 유형·장소·계절 조합 필터, URL 검색어(`q`)·필터 유지 및 상세 복귀 보존 |
| `/discover/:id` | 격리된 샘플 상세, 가상 값 및 정보 부족 표시 |
| `/plants` | 장소 필터, 빈 상태, 개체·그룹 예시 |
| `/plants/preview` | 상세 영역 전환과 예정 기능 안내 |
| `/journal` | 타임라인·달력 전환, 월 이동, 사진 카드 예시 |
| `/journal/new` | 메모리 내 폼 입력과 초기화 확인, 비활성 저장 |
| `/settings` | 환경·테마·데이터·백업·앱 셸 상태 안내 |
| `/week`, `/check` | 주간 빈 상태와 진단 기능 준비 안내 |
| 그 밖의 경로 | 앱 내 404 |

샘플 카탈로그는 `src/features/discover/demo-catalog.ts`의 UI 전용 타입입니다. 영속 도메인 모델이 아니며 식물의 실제 재배 장소·계절·난이도를 판단하는 자료로 사용하면 안 됩니다. 공식 자료·API·개인 기록과 연결되지 않습니다.

## PWA 확인

```bash
npm run build
npm run preview
```

온라인에서 preview를 한 번 열고 앱 정보의 오프라인 준비 상태를 확인한 뒤 네트워크를 끊어 새로고침하거나 앱을 재시작하세요. 개발 서버에서는 서비스워커를 등록하지 않습니다. 배포 대상은 origin 루트이며 HTTPS 또는 localhost가 필요합니다. 실제 설치 및 OS 알림은 별도 검증 대상입니다.

서비스워커는 빌드 파일과 명시된 아이콘·manifest만 캐시합니다. 런타임 API, 개인 입력, IndexedDB, 사진, 토큰을 읽거나 저장하지 않습니다. 업데이트는 대기 후 사용자 확인을 거쳐 활성화하며, 최초 설치는 임시 입력을 지우는 새로고침을 하지 않습니다. 다른 캐시나 구 앱 셸 캐시를 자동 삭제하지 않으므로 장기 버전 누적 정리는 후속 정책 검증 대상입니다.

정적 호스팅 시 실제 파일을 먼저 제공하고 SPA 경로는 `index.html`로 재작성해야 합니다. `sw.js`는 재검증 가능한 캐시 헤더, 해시가 붙은 assets는 immutable 정책을 권장합니다. 이번 작업은 호스팅·Production 배포를 포함하지 않습니다.

## 검증 경계

사용자 데이터 영속화, 실제 등록·급수·일기·사진 저장, ZIP, Drive OAuth, 실제 기상·진단은 구현하지 않았습니다. 폼 입력은 화면 이동이나 새로고침 시 사라집니다. 디자인 토큰은 의미별 CSS 변수로 분리하되 라이트 테마만 제공합니다.

`src/test`는 34개 단위·컴포넌트·PWA 상태 테스트를 제공하고, `tests/e2e`는 15개 Chromium 기반 경로·반응형·터치 타깃·키보드·자동 접근성·오프라인·업데이트·실패 전환 검증을 제공합니다. 자동 접근성 검사는 수동 스크린리더 검증이나 WCAG 전체 준수 인증을 대체하지 않습니다. 실제 결과와 브라우저 제한은 구현 보고서를 확인하세요.

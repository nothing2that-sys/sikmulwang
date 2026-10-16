import {
  PageContainer,
  PageHeading,
} from "../../components/layout/PageContainer";
import { StatusBadge } from "../../components/common/Feedback";
import { usePwa } from "../../app/providers/PwaProvider";

export function SettingsPage() {
  const { status, updateState } = usePwa();
  const statusLabels = {
    development: "개발 서버 · 오프라인 캐시 사용 안 함",
    unsupported: "이 브라우저에서는 서비스워커를 지원하지 않아요",
    registering: "오프라인 화면 준비 중",
    ready: "앱 셸 오프라인 준비됨",
    error: "오프라인 준비 실패",
  };
  return (
    <PageContainer>
      <PageHeading
        eyebrow="나의 환경과 데이터"
        title="설정 및 데이터 관리"
        description="현재 제공되는 기능과 준비 중인 기능을 확인하세요."
      />
      <div className="settings-grid">
        <section className="card">
          <h2>지역 및 재배 환경</h2>
          <StatusBadge>Phase 1 예정</StatusBadge>
          <p>지역 미설정 · 저장 기능 준비 중</p>
          <p className="field-hint">
            실내·베란다·야외, 강수 노출, 일조 조건을 따로 관리할 예정입니다.
            위치 권한은 요청하지 않습니다.
          </p>
        </section>
        <section className="card">
          <h2>표시 테마</h2>
          <StatusBadge>라이트 테마</StatusBadge>
          <p>아이보리와 짙은 녹색의 기본 테마예요.</p>
          <p className="field-hint">다크 테마 전환은 아직 제공하지 않습니다.</p>
        </section>
        <section className="card">
          <h2>데이터 관리</h2>
          <p>현재 개인 데이터는 저장하지 않아요.</p>
          <p className="field-hint">
            앱 셸 캐시는 다시 만들 수 있는 정적 화면입니다. 개인 식물·일기
            백업과 다릅니다.
          </p>
          <div className="setting-row">
            <span>이 기기에 저장된 데이터</span>
            <StatusBadge>저장 미구현</StatusBadge>
          </div>
        </section>
        <section className="card">
          <h2>백업 및 복원</h2>
          <p id="backup-hint">
            안전한 데이터 계약 검증 이후 연결됩니다. 지금은 아무 파일도
            가져오거나 내보내지 않습니다.
          </p>
          <div className="planned-actions">
            <button disabled aria-describedby="backup-hint">
              ZIP 내보내기 · Phase 4 예정
            </button>
            <button disabled aria-describedby="backup-hint">
              백업 가져오기 · Phase 4 예정
            </button>
            <button disabled aria-describedby="backup-hint">
              개인 Google Drive 연결 · Phase 7 예정
            </button>
          </div>
        </section>
        <section className="card">
          <h2>앱 정보</h2>
          <dl className="detail-list">
            <div>
              <dt>현재 버전</dt>
              <dd>Phase 0 웹 기반</dd>
            </div>
            <div>
              <dt>오프라인</dt>
              <dd>
                <span role="status">{statusLabels[status]}</span>
                {updateState === "error" && (
                  <p className="field-error">
                    새 버전 업데이트 실패 · 기존 오프라인 화면 유지됨
                  </p>
                )}
              </dd>
            </div>
            <div>
              <dt>설계 상태</dt>
              <dd>DESIGN_REWORK_DRAFT</dd>
            </div>
          </dl>
          <p className="field-hint">
            PWA 설치 가능 여부는 브라우저와 운영체제에 따라 달라요. 백그라운드
            알림은 제공하지 않습니다.
          </p>
        </section>
      </div>
    </PageContainer>
  );
}

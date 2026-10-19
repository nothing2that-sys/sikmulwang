//+_+// Settings page showing profile/generation metadata, locations, and trash management
import {
  PageContainer,
  PageHeading,
} from "../../components/layout/PageContainer";
import { StatusBadge } from "../../components/common/Feedback";
import { usePwa } from "../../app/providers/PwaProvider";
import { useDb } from "../../lib/db/DbContext";

export function SettingsPage() {
  const { status, updateState } = usePwa();
  const { meta, locations, trashedPlantings, restorePlantingItem, purgePlantingItem } =
    useDb();

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
        description="현재 로컬 데이터베이스와 환경 설정을 확인하세요."
      />
      <div className="settings-grid">
        {/* 1. 프로필 및 세대 정보 */}
        <section className="card">
          <h2>로컬 데이터베이스 및 세대</h2>
          <StatusBadge>Phase 1 로컬 데이터</StatusBadge>
          <dl className="detail-list" style={{ marginTop: "0.75rem" }}>
            <div>
              <dt>활성 프로필</dt>
              <dd>{meta?.activeProfileId ?? "p_default"}</dd>
            </div>
            <div>
              <dt>활성 세대 (Generation)</dt>
              <dd>{meta?.activeGenerationId ?? "g_default"}</dd>
            </div>
            <div>
              <dt>DB 스키마 버전</dt>
              <dd>v{meta?.schemaVersion ?? 1} (sikmulwang-db)</dd>
            </div>
            <div>
              <dt>트랜잭션 Epoch</dt>
              <dd>{meta?.epoch ?? 1}</dd>
            </div>
            <div>
              <dt>쓰기 펜스 상태</dt>
              <dd>
                {meta?.writeFence ? (
                  <span className="badge badge-warning">차단 중 (백업/복원)</span>
                ) : (
                  <span className="badge badge-neutral">정상 (쓰기 가능)</span>
                )}
              </dd>
            </div>
          </dl>
          <p className="field-hint">
            모든 사용자 데이터는 활성 세대 식별자로 네임스페이스화되며 IndexedDB에 로컬 저장됩니다.
          </p>
        </section>

        {/* 2. 등록된 재배 장소 */}
        <section className="card">
          <h2>등록된 재배 환경</h2>
          <p className="field-hint">
            실내·베란다·야외 등 식물마다 다른 환경을 기록합니다.
          </p>
          <ul style={{ paddingLeft: "1.2rem", marginTop: "0.5rem" }}>
            {locations.map((loc) => (
              <li key={loc.id} style={{ marginBottom: "0.25rem" }}>
                <strong>{loc.label}</strong> ({loc.environmentType} · {loc.sunExposure})
              </li>
            ))}
          </ul>
        </section>

        {/* 3. 휴지통 관리 */}
        <section className="card">
          <h2>휴지통 관리</h2>
          <p className="field-hint">
            삭제된 식물은 30일간 보존되며, 언제든 복원하거나 즉시 영구 삭제할 수 있습니다.
          </p>
          {trashedPlantings.length === 0 ? (
            <p style={{ marginTop: "0.5rem", color: "var(--muted)" }}>
              휴지통이 비어 있어요.
            </p>
          ) : (
            <div style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {trashedPlantings.map((plant) => (
                <div
                  key={plant.id}
                  className="card"
                  style={{
                    background: "var(--background)",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "0.75rem 1rem",
                  }}
                >
                  <div>
                    <strong>{plant.displayName}</strong>
                    <span className="field-hint" style={{ display: "block" }}>
                      삭제일: {plant.updatedAt.slice(0, 10)}
                    </span>
                  </div>
                  <div className="button-row">
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => restorePlantingItem(plant.id)}
                    >
                      복원
                    </button>
                    <button
                      type="button"
                      className="button secondary"
                      style={{ color: "var(--danger)" }}
                      onClick={() => {
                        if (window.confirm(`'${plant.displayName}'을(를) 영구 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) {
                          purgePlantingItem(plant.id);
                        }
                      }}
                    >
                      영구 삭제
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 4. 백업 및 복원 (Phase 4 예정) */}
        <section className="card">
          <h2>백업 및 복원</h2>
          <p id="backup-hint">
            안전한 데이터 계약 검증 이후 연결됩니다. 지금은 아무 파일도 가져오거나 내보내지 않습니다.
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

        {/* 5. 표시 테마 */}
        <section className="card">
          <h2>표시 테마</h2>
          <StatusBadge>라이트 테마</StatusBadge>
          <p>아이보리와 짙은 녹색의 기본 테마예요.</p>
          <p className="field-hint">다크 테마 전환은 아직 제공하지 않습니다.</p>
        </section>

        {/* 6. 앱 정보 */}
        <section className="card">
          <h2>앱 정보</h2>
          <dl className="detail-list">
            <div>
              <dt>현재 버전</dt>
              <dd>Phase 1 로컬 데이터 기반</dd>
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

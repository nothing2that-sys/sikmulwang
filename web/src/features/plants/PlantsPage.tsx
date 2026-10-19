//+_+// P1 PlantsPage connected to IndexedDB for plant, location, group, and season CRUD with concurrency protection
import { useState, useId, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  PageContainer,
  PageHeading,
} from "../../components/layout/PageContainer";
import {
  EmptyState,
  PhaseNotice,
  StatusBadge,
} from "../../components/common/Feedback";
import { PlantCard } from "../../components/common/PlantCard";
import { ModalDialog } from "../../components/common/ModalDialog";
import { demoCatalog } from "../discover/demo-catalog";
import { useDb } from "../../lib/db/DbContext";
import type {
  PlantingRecord,
  GroupType,
  GrowingStatus,
  CycleRecord,
  EnvironmentHistoryRecord,
  LocationRecord,
  EnvironmentType,
  RainfallExposure,
  SunExposure,
} from "../../lib/db/types";
import { getEnvironmentHistories } from "../../lib/db/plantingRepository";
import { getLocalDateString } from "../../lib/db/validators";
import { AlertCircle, RefreshCw, Plus, Edit2, Trash2 } from "lucide-react";

export function PlantsPage() {
  const {
    isReady,
    error,
    locations,
    plantings,
    addLocation,
    editLocation,
    removeLocation,
    addPlanting,
    editPlanting,
    movePlanting,
    splitPlanting,
    changeQuantity,
    removePlanting,
    startNewCycle,
    finishCycle,
    getActiveCycleForPlanting,
    refresh,
    db,
  } = useDb();

  const [selectedPlace, setSelectedPlace] = useState<string>("전체");
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isManageLocationsOpen, setIsManageLocationsOpen] = useState(false);
  const [managingPlantId, setManagingPlantId] = useState<string | null>(null);
  const [plantDialogVersion, setPlantDialogVersion] = useState<number>(0);

  // Sync managingPlant with latest record in plantings
  const managingPlant = managingPlantId
    ? plantings.find((p) => p.id === managingPlantId) ?? null
    : null;

  if (error) {
    return (
      <PageContainer>
        <PageHeading
          eyebrow="우리 집 작은 정원"
          title="내 식물"
          description="데이터베이스를 불러오는 중 문제가 발생했습니다."
        />
        <section className="card space-section" role="alert">
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--danger)" }}>
            <AlertCircle size={20} aria-hidden="true" />
            <h2>데이터베이스 접근 오류</h2>
          </div>
          <p className="field-error" style={{ marginTop: "0.5rem" }}>
            {error.message}
          </p>
          <div className="button-row" style={{ marginTop: "1rem" }}>
            <button type="button" className="button" onClick={() => refresh()}>
              다시 시도
            </button>
          </div>
        </section>
      </PageContainer>
    );
  }

  if (!isReady) {
    return (
      <PageContainer>
        <PageHeading
          eyebrow="우리 집 작은 정원"
          title="내 식물"
          description="식물 데이터를 준비하고 있습니다..."
        />
        <section className="card space-section">
          <p className="muted">로컬 데이터를 준비하고 있습니다...</p>
        </section>
      </PageContainer>
    );
  }

  // Filter plants by selected location label or '전체'
  const filteredPlantings = plantings.filter((plant) => {
    if (selectedPlace === "전체") return true;
    const loc = locations.find((l) => l.id === plant.locationId);
    return loc ? loc.label === selectedPlace : false;
  });

  return (
    <PageContainer>
      <PageHeading
        eyebrow="우리 집 작은 정원"
        title="내 식물"
        description="식물마다 다른 공간, 다른 이야기를 모아요."
      />

      <div className="button-row" style={{ marginBottom: "1rem" }}>
        <button
          type="button"
          className="button"
          onClick={() => setIsAddModalOpen(true)}
        >
          새 식물 심기
        </button>
        <button
          type="button"
          className="button secondary"
          onClick={() => setIsManageLocationsOpen(true)}
        >
          재배 장소 관리
        </button>
      </div>

      <div className="segmented" aria-label="장소별 보기">
        {["전체", ...locations.map((loc) => loc.label)].map((value) => (
          <button
            type="button"
            key={value}
            aria-pressed={value === selectedPlace}
            onClick={() => setSelectedPlace(value)}
          >
            {value}
          </button>
        ))}
      </div>

      {filteredPlantings.length === 0 ? (
        <section className="card space-section">
          <EmptyState
            title={
              selectedPlace === "전체"
                ? "아직 함께하는 식물이 없어요"
                : `${selectedPlace}에 등록된 식물이 없어요`
            }
            description="새 식물을 등록하고 장소와 성장 이야기를 기록해 보세요."
            action={
              <div className="button-row">
                <button
                  type="button"
                  className="button"
                  onClick={() => setIsAddModalOpen(true)}
                >
                  첫 식물 등록하기
                </button>
                <Link className="button secondary" to="/plants/preview">
                  식물 상세 화면 미리보기
                </Link>
              </div>
            }
          />
        </section>
      ) : (
        <section className="plant-grid space-section">
          {filteredPlantings.map((plant) => {
            const loc = locations.find((l) => l.id === plant.locationId);
            const statusMap: Record<GrowingStatus, { text: string; tone?: "neutral" | "warning" | "danger" }> = {
              GROWING: { text: "생육 중" },
              HARVESTED: { text: "수확 완료", tone: "neutral" },
              DORMANT: { text: "휴면 중", tone: "warning" },
              DEAD: { text: "고사", tone: "danger" },
            };
            const statusInfo = statusMap[plant.growingStatus] ?? { text: plant.growingStatus };

            return (
              <article key={plant.id} className="card plant-card">
                <div className="badge-row">
                  <StatusBadge tone={statusInfo.tone}>{statusInfo.text}</StatusBadge>
                  <span className="source-tag">{loc?.label ?? "장소 미지정"}</span>
                </div>
                <h2>{plant.displayName}</h2>
                <p className="card-summary">
                  {plant.groupType === "INDIVIDUAL"
                    ? `개체 · 1${plant.unit}`
                    : `그룹 · ${plant.quantity}${plant.unit}`}
                </p>
                {plant.quantityChangeReason && (
                  <p className="field-hint" style={{ whiteSpace: "pre-line" }}>
                    {plant.quantityChangeReason}
                  </p>
                )}
                <div className="button-row" style={{ marginTop: "0.75rem" }}>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => setManagingPlantId(plant.id)}
                  >
                    관리하기
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      )}

      {isAddModalOpen && (
        <AddPlantDialog
          locations={locations}
          onClose={() => setIsAddModalOpen(false)}
          onAdd={async (params) => {
            await addPlanting(params);
            setIsAddModalOpen(false);
          }}
        />
      )}

      {managingPlant && (
        <ManagePlantDialog
          key={`${managingPlant.id}-${plantDialogVersion}`}
          plant={managingPlant}
          locations={locations}
          onClose={() => setManagingPlantId(null)}
          onEditBasicInfo={async (params) => {
            await editPlanting(managingPlant.id, params, managingPlant.revision);
          }}
          onMove={async (newLocId, effectiveAt) => {
            await movePlanting(
              managingPlant.id,
              newLocId,
              effectiveAt,
              managingPlant.revision
            );
          }}
          onQuantityChange={async (newQty, reason) => {
            await changeQuantity(
              managingPlant.id,
              newQty,
              reason,
              managingPlant.revision
            );
          }}
          onSplitGroup={async (splitQty, newName, reason) => {
            await splitPlanting(
              managingPlant.id,
              splitQty,
              newName,
              reason,
              managingPlant.revision
            );
          }}
          onDelete={async () => {
            await removePlanting(managingPlant.id, managingPlant.revision);
            setManagingPlantId(null);
          }}
          getActiveCycle={() => getActiveCycleForPlanting(managingPlant.id)}
          onStartCycle={(startDate) => startNewCycle(managingPlant.id, startDate)}
          onEndCycle={(cycleId, endDate, expectedRev) =>
            finishCycle(cycleId, endDate, expectedRev)
          }
          fetchHistories={() =>
            getEnvironmentHistories(db, managingPlant.generationId, managingPlant.id)
          }
          onRefreshLatest={async () => {
            await refresh();
            setPlantDialogVersion((v) => v + 1);
          }}
        />
      )}

      {isManageLocationsOpen && (
        <ManageLocationsDialog
          locations={locations}
          onClose={() => setIsManageLocationsOpen(false)}
          onAddLocation={addLocation}
          onEditLocation={editLocation}
          onDeleteLocation={removeLocation}
        />
      )}

      <details className="sample-details space-section">
        <summary>개체·그룹 카드 구성 보기 (개발 샘플)</summary>
        <PhaseNotice>
          다음 카드는 실제 개인 식물이 아닌 개발용 예시입니다.
        </PhaseNotice>
        <div className="plant-grid">
          {demoCatalog
            .filter((plant) => selectedPlace === "전체" || plant.place === selectedPlace)
            .map((plant, index) => (
              <PlantCard
                key={plant.id}
                plant={plant}
                groupLabel={index === 0 ? "개체 · 예시 1개" : "그룹 · 예시 3개"}
              />
            ))}
        </div>
      </details>
    </PageContainer>
  );
}

//+_+// Add Plant Modal Dialog Component
function AddPlantDialog({
  locations,
  onClose,
  onAdd,
}: {
  locations: Array<{ id: string; label: string }>;
  onClose: () => void;
  onAdd: (params: {
    displayName: string;
    groupType: GroupType;
    quantity: number;
    unit: string;
    locationId: string;
    growingStatus: GrowingStatus;
    startLocalDate?: string;
  }) => Promise<void>;
}) {
  const id = useId();
  const [name, setName] = useState("");
  const [groupType, setGroupType] = useState<GroupType>("INDIVIDUAL");
  const [quantity, setQuantity] = useState(1);
  const [unit, setUnit] = useState("그루");
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const locationId = selectedLocationId || locations[0]?.id || "";
  const [growingStatus, setGrowingStatus] = useState<GrowingStatus>("GROWING");
  const [startLocalDate, setStartLocalDate] = useState(() => getLocalDateString());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMsg("식물 이름을 입력해 주세요.");
      return;
    }
    if (!locationId) {
      setErrorMsg("재배 장소를 선택해 주세요.");
      return;
    }
    try {
      setIsSubmitting(true);
      setErrorMsg("");
      await onAdd({
        displayName: name.trim(),
        groupType,
        quantity: groupType === "INDIVIDUAL" ? 1 : quantity,
        unit: unit.trim() || (groupType === "INDIVIDUAL" ? "그루" : "개"),
        locationId,
        growingStatus,
        startLocalDate: startLocalDate || undefined,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setIsSubmitting(false);
    }
  };

  return (
    <ModalDialog labelledBy={`${id}-title`} onClose={onClose}>
      <h2 id={`${id}-title`}>새 식물 심기</h2>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {errorMsg && (
          <p className="field-error" role="alert">
            {errorMsg}
          </p>
        )}
        <div>
          <label htmlFor={`${id}-name`} style={{ display: "block", fontWeight: 600, marginBottom: "0.25rem" }}>
            식물 이름 (애칭 또는 품종) *
          </label>
          <input
            id={`${id}-name`}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: 몬스테라, 방울토마토 1호"
            required
            autoFocus
          />
        </div>

        <div>
          <label htmlFor={`${id}-groupType`} style={{ display: "block", fontWeight: 600, marginBottom: "0.25rem" }}>
            관리 형태
          </label>
          <select
            id={`${id}-groupType`}
            value={groupType}
            onChange={(e) => {
              const val = e.target.value as GroupType;
              setGroupType(val);
              if (val === "INDIVIDUAL") {
                setQuantity(1);
                setUnit("그루");
              } else {
                setUnit("개");
              }
            }}
          >
            <option value="INDIVIDUAL">개체 (단일 화분/나무)</option>
            <option value="GROUP">그룹 (모종판/다육 화단 등)</option>
          </select>
        </div>

        {groupType === "GROUP" && (
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <div style={{ flex: 1 }}>
              <label htmlFor={`${id}-quantity`} style={{ display: "block", fontWeight: 600, marginBottom: "0.25rem" }}>
                수량 *
              </label>
              <input
                id={`${id}-quantity`}
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
                required
              />
            </div>
            <div style={{ width: "100px" }}>
              <label htmlFor={`${id}-unit`} style={{ display: "block", fontWeight: 600, marginBottom: "0.25rem" }}>
                단위
              </label>
              <input
                id={`${id}-unit`}
                type="text"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="개, 포기"
              />
            </div>
          </div>
        )}

        <div>
          <label htmlFor={`${id}-location`} style={{ display: "block", fontWeight: 600, marginBottom: "0.25rem" }}>
            재배 장소 *
          </label>
          <select
            id={`${id}-location`}
            value={locationId}
            onChange={(e) => setSelectedLocationId(e.target.value)}
            required
          >
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor={`${id}-status`} style={{ display: "block", fontWeight: 600, marginBottom: "0.25rem" }}>
            생육 상태
          </label>
          <select
            id={`${id}-status`}
            value={growingStatus}
            onChange={(e) => setGrowingStatus(e.target.value as GrowingStatus)}
          >
            <option value="GROWING">생육 중</option>
            <option value="DORMANT">휴면 중</option>
            <option value="HARVESTED">수확 완료</option>
            <option value="DEAD">고사</option>
          </select>
        </div>

        <div>
          <label htmlFor={`${id}-startDate`} style={{ display: "block", fontWeight: 600, marginBottom: "0.25rem" }}>
            시즌 시작일 (선택)
          </label>
          <input
            id={`${id}-startDate`}
            type="date"
            value={startLocalDate}
            onChange={(e) => setStartLocalDate(e.target.value)}
          />
        </div>

        <div className="button-row" style={{ marginTop: "0.5rem" }}>
          <button
            type="button"
            className="button secondary"
            onClick={onClose}
            disabled={isSubmitting}
          >
            취소
          </button>
          <button type="submit" className="button" disabled={isSubmitting}>
            {isSubmitting ? "등록 중..." : "식물 등록 완료"}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}

//+_+// Manage Plant Modal Dialog Component
function ManagePlantDialog({
  plant,
  locations,
  onClose,
  onEditBasicInfo,
  onMove,
  onQuantityChange,
  onSplitGroup,
  onDelete,
  getActiveCycle,
  onStartCycle,
  onEndCycle,
  fetchHistories,
  onRefreshLatest,
}: {
  plant: PlantingRecord;
  locations: Array<{ id: string; label: string }>;
  onClose: () => void;
  onEditBasicInfo: (params: {
    displayName?: string;
    unit?: string;
    growingStatus?: GrowingStatus;
  }) => Promise<void>;
  onMove: (newLocationId: string, effectiveAt?: string) => Promise<void>;
  onQuantityChange: (newQuantity: number, reason: string) => Promise<void>;
  onSplitGroup: (splitQty: number, newName: string, reason: string) => Promise<void>;
  onDelete: () => Promise<void>;
  getActiveCycle: () => Promise<CycleRecord | undefined>;
  onStartCycle: (startDate: string) => Promise<CycleRecord>;
  onEndCycle: (cycleId: string, endDate: string, expectedRevision?: number) => Promise<CycleRecord>;
  fetchHistories: () => Promise<EnvironmentHistoryRecord[]>;
  onRefreshLatest: () => Promise<void>;
}) {
  const id = useId();
  const [activeCycle, setActiveCycle] = useState<CycleRecord | undefined>(undefined);
  const [histories, setHistories] = useState<EnvironmentHistoryRecord[]>([]);
  const [message, setMessage] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [isConflict, setIsConflict] = useState<boolean>(false);

  // Basic Info Form states
  const [editName, setEditName] = useState(plant.displayName);
  const [editUnit, setEditUnit] = useState(plant.unit);
  const [editStatus, setEditStatus] = useState<GrowingStatus>(plant.growingStatus);

  // Sub-action states
  const [targetLocationId, setTargetLocationId] = useState(plant.locationId);
  const [qtyValue, setQtyValue] = useState(plant.quantity);
  const [qtyReason, setQtyReason] = useState("");
  const [splitQty, setSplitQty] = useState(1);
  const [splitName, setSplitName] = useState(`${plant.displayName} (분할)`);
  const [splitReason, setSplitReason] = useState("");
  const [newCycleDate, setNewCycleDate] = useState(() => getLocalDateString());
  const [endCycleDate, setEndCycleDate] = useState(() => getLocalDateString());

  useEffect(() => {
    getActiveCycle().then(setActiveCycle);
    fetchHistories().then(setHistories);
  }, [getActiveCycle, fetchHistories]);

  const currentLocation = locations.find((l) => l.id === plant.locationId);

  const handleConflictReload = async () => {
    await onRefreshLatest();
    setIsConflict(false);
    setErrorMsg("");
    setMessage("최신 데이터를 다시 불러왔습니다.");
  };

  return (
    <ModalDialog labelledBy={`${id}-manage-title`} onClose={onClose}>
      <h2 id={`${id}-manage-title`}>{plant.displayName} 관리</h2>
      <p className="card-summary" style={{ marginBottom: "0.5rem" }}>
        현재 장소: <strong>{currentLocation?.label ?? "장소 미지정"}</strong> ·{" "}
        형태: <strong>{plant.groupType === "INDIVIDUAL" ? "개체 (1그루)" : `그룹 (${plant.quantity}${plant.unit})`}</strong> ·{" "}
        버전(Rev): <strong>{plant.revision}</strong>
      </p>

      {message && (
        <p className="badge badge-neutral" style={{ display: "block", marginBottom: "0.5rem" }}>
          {message}
        </p>
      )}

      {errorMsg && (
        <div style={{ marginBottom: "0.75rem" }}>
          <p className="field-error" role="alert" style={{ marginBottom: isConflict ? "0.25rem" : "0" }}>
            {errorMsg}
          </p>
          {isConflict && (
            <button
              type="button"
              className="button secondary"
              style={{ fontSize: "0.85rem", padding: "0.25rem 0.5rem", marginTop: "0.25rem" }}
              onClick={handleConflictReload}
            >
              <RefreshCw size={14} aria-hidden="true" style={{ marginRight: "0.25rem" }} />
              최신 정보 확인 및 다시 불러오기
            </button>
          )}
        </div>
      )}

      {/* 0. 기본 정보 수정 */}
      <section className="card" style={{ marginBottom: "1rem", background: "var(--background)" }}>
        <h3>기본 정보 수정</h3>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              setErrorMsg("");
              setIsConflict(false);
              await onEditBasicInfo({
                displayName: editName,
                unit: editUnit,
                growingStatus: editStatus,
              });
              setMessage("기본 정보를 성공적으로 수정했습니다.");
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              setErrorMsg(msg);
              if (err && typeof err === "object" && "name" in err && err.name === "ConflictError") {
                setIsConflict(true);
              }
            }
          }}
          style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "0.5rem" }}
        >
          <div>
            <label htmlFor={`${id}-edit-name`} style={{ display: "block", fontSize: "0.9rem", fontWeight: 600 }}>
              식물 이름
            </label>
            <input
              id={`${id}-edit-name`}
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              required
            />
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <div style={{ flex: 1 }}>
              <label htmlFor={`${id}-edit-status`} style={{ display: "block", fontSize: "0.9rem", fontWeight: 600 }}>
                생육 상태
              </label>
              <select
                id={`${id}-edit-status`}
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value as GrowingStatus)}
              >
                <option value="GROWING">생육 중</option>
                <option value="DORMANT">휴면 중</option>
                <option value="HARVESTED">수확 완료</option>
                <option value="DEAD">고사</option>
              </select>
            </div>
            <div style={{ width: "100px" }}>
              <label htmlFor={`${id}-edit-unit`} style={{ display: "block", fontSize: "0.9rem", fontWeight: 600 }}>
                단위
              </label>
              <input
                id={`${id}-edit-unit`}
                type="text"
                value={editUnit}
                onChange={(e) => setEditUnit(e.target.value)}
              />
            </div>
          </div>
          <div className="button-row">
            <button type="submit" className="button">
              기본 정보 저장
            </button>
          </div>
        </form>
      </section>

      {/* 1. 장소 이동 */}
      <section className="card" style={{ marginBottom: "1rem", background: "var(--background)" }}>
        <h3>장소 이동</h3>
        <p className="field-hint">장소를 이동하면 환경 이력에 이전 장소 종료 시각과 새 장소 시작 시각이 무손실 기록됩니다.</p>
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
          <select
            aria-label="이동할 장소 선택"
            value={targetLocationId}
            onChange={(e) => setTargetLocationId(e.target.value)}
            style={{ flex: 1 }}
          >
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="button"
            disabled={targetLocationId === plant.locationId}
            onClick={async () => {
              try {
                setErrorMsg("");
                setIsConflict(false);
                await onMove(targetLocationId);
                setMessage("장소를 성공적으로 이동했습니다.");
                fetchHistories().then(setHistories);
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                setErrorMsg(msg);
                if (err && typeof err === "object" && "name" in err && err.name === "ConflictError") {
                  setIsConflict(true);
                }
              }
            }}
          >
            장소 이동 실행
          </button>
        </div>
      </section>

      {/* 2. 수량 변경 */}
      <section className="card" style={{ marginBottom: "1rem", background: "var(--background)" }}>
        <h3>수량 변경</h3>
        <p className="field-hint">개체 폐기나 추가 식재로 인한 수량 변경 시 사유를 누적 보존합니다.</p>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.5rem" }}>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input
              aria-label="수량 변경값"
              type="number"
              min={1}
              value={qtyValue}
              onChange={(e) => setQtyValue(Math.max(1, parseInt(e.target.value, 10) || 1))}
              style={{ width: "100px" }}
            />
            <input
              aria-label="수량 변경 사유"
              type="text"
              placeholder="수량 변경 사유 (필수)"
              value={qtyReason}
              onChange={(e) => setQtyReason(e.target.value)}
              style={{ flex: 1 }}
            />
          </div>
          <button
            type="button"
            className="button"
            disabled={qtyValue === plant.quantity || !qtyReason.trim()}
            onClick={async () => {
              try {
                setErrorMsg("");
                setIsConflict(false);
                await onQuantityChange(qtyValue, qtyReason);
                setMessage("수량이 성공적으로 변경되었습니다.");
                setQtyReason("");
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                setErrorMsg(msg);
                if (err && typeof err === "object" && "name" in err && err.name === "ConflictError") {
                  setIsConflict(true);
                }
              }
            }}
          >
            수량 변경 저장
          </button>
        </div>
      </section>

      {/* 3. 그룹 분할 */}
      {plant.groupType === "GROUP" && plant.quantity > 1 && (
        <section className="card" style={{ marginBottom: "1rem", background: "var(--background)" }}>
          <h3>그룹 분할</h3>
          <p className="field-hint">
            일부 개체를 독립 분리하여 새 식물로 분할 생성합니다. (남은 수량: {plant.quantity - splitQty})
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.5rem" }}>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input
                aria-label="분할 수량"
                type="number"
                min={1}
                max={plant.quantity - 1}
                value={splitQty}
                onChange={(e) => setSplitQty(Math.max(1, Math.min(plant.quantity - 1, parseInt(e.target.value, 10) || 1)))}
                style={{ width: "80px" }}
              />
              <input
                aria-label="분할 새 식물 이름"
                type="text"
                placeholder="분할 새 식물 이름"
                value={splitName}
                onChange={(e) => setSplitName(e.target.value)}
                style={{ flex: 1 }}
              />
            </div>
            <input
              aria-label="분할 사유"
              type="text"
              placeholder="분할 사유 (선택)"
              value={splitReason}
              onChange={(e) => setSplitReason(e.target.value)}
            />
            <button
              type="button"
              className="button"
              onClick={async () => {
                try {
                  setErrorMsg("");
                  setIsConflict(false);
                  await onSplitGroup(splitQty, splitName, splitReason);
                  setMessage("그룹을 분할하여 새 식물을 생성했습니다.");
                  setSplitQty(1);
                } catch (err) {
                  const msg = err instanceof Error ? err.message : String(err);
                  setErrorMsg(msg);
                  if (err && typeof err === "object" && "name" in err && err.name === "ConflictError") {
                    setIsConflict(true);
                  }
                }
              }}
            >
              그룹 분할 실행
            </button>
          </div>
        </section>
      )}

      {/* 4. 시즌 관리 */}
      <section className="card" style={{ marginBottom: "1rem", background: "var(--background)" }}>
        <h3>시즌(Cycle) 관리</h3>
        {activeCycle ? (
          <div>
            <p>
              현재 진행 중인 시즌: <strong>{activeCycle.startLocalDate} 시작</strong> (Rev: {activeCycle.revision})
            </p>
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
              <input
                type="date"
                value={endCycleDate}
                onChange={(e) => setEndCycleDate(e.target.value)}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="button secondary"
                onClick={async () => {
                  try {
                    setErrorMsg("");
                    setIsConflict(false);
                    await onEndCycle(activeCycle.id, endCycleDate, activeCycle.revision);
                    setMessage("시즌을 성공적으로 종료했습니다.");
                    getActiveCycle().then(setActiveCycle);
                  } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    setErrorMsg(msg);
                    if (err && typeof err === "object" && "name" in err && err.name === "ConflictError") {
                      setIsConflict(true);
                    }
                  }
                }}
              >
                시즌 종료
              </button>
            </div>
          </div>
        ) : (
          <div>
            <p className="field-hint">진행 중인 활성 시즌이 없습니다.</p>
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
              <input
                type="date"
                value={newCycleDate}
                onChange={(e) => setNewCycleDate(e.target.value)}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="button"
                onClick={async () => {
                  try {
                    setErrorMsg("");
                    setIsConflict(false);
                    await onStartCycle(newCycleDate);
                    setMessage("새 시즌을 시작했습니다.");
                    getActiveCycle().then(setActiveCycle);
                  } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    setErrorMsg(msg);
                    if (err && typeof err === "object" && "name" in err && err.name === "ConflictError") {
                      setIsConflict(true);
                    }
                  }
                }}
              >
                새 시즌 시작
              </button>
            </div>
          </div>
        )}
      </section>

      {/* 5. 환경 이력 */}
      {histories.length > 0 && (
        <details style={{ marginBottom: "1rem" }}>
          <summary>환경 이력 ({histories.length}건)</summary>
          <ul style={{ paddingLeft: "1.2rem", marginTop: "0.5rem", fontSize: "0.9rem" }}>
            {histories.map((h) => (
              <li key={h.id}>
                <strong>{h.environmentSnapshot.label}</strong> ({h.validFrom.slice(0, 10)} ~{" "}
                {h.validTo ? h.validTo.slice(0, 10) : "현재"})
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* 6. 수량 변경 사유 이력 */}
      {plant.quantityChangeReason && (
        <details style={{ marginBottom: "1rem" }}>
          <summary>수량 변경 감사 이력</summary>
          <div style={{ background: "var(--background)", padding: "0.5rem", borderRadius: "4px", marginTop: "0.5rem" }}>
            <pre style={{ margin: 0, fontSize: "0.85rem", whiteSpace: "pre-wrap" }}>
              {plant.quantityChangeReason}
            </pre>
          </div>
        </details>
      )}

      {/* 7. 식물 삭제 (휴지통) */}
      <div className="button-row" style={{ marginTop: "1rem" }}>
        <button
          type="button"
          className="button secondary"
          style={{ color: "var(--danger)" }}
          onClick={async () => {
            if (window.confirm(`'${plant.displayName}' 식물을 휴지통으로 이동할까요?`)) {
              try {
                await onDelete();
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                setErrorMsg(msg);
                if (err && typeof err === "object" && "name" in err && err.name === "ConflictError") {
                  setIsConflict(true);
                }
              }
            }
          }}
        >
          휴지통으로 이동
        </button>
        <button type="button" className="button" onClick={onClose}>
          닫기
        </button>
      </div>
    </ModalDialog>
  );
}

//+_+// Manage Locations Modal Dialog Component
function ManageLocationsDialog({
  locations,
  onClose,
  onAddLocation,
  onEditLocation,
  onDeleteLocation,
}: {
  locations: LocationRecord[];
  onClose: () => void;
  onAddLocation: (params: {
    label: string;
    environmentType: EnvironmentType;
    rainfallExposure: RainfallExposure;
    sunExposure: SunExposure;
    timeZone?: string;
  }) => Promise<LocationRecord>;
  onEditLocation: (
    id: string,
    params: {
      label?: string;
      environmentType?: EnvironmentType;
      rainfallExposure?: RainfallExposure;
      sunExposure?: SunExposure;
      timeZone?: string;
      expectedRevision?: number;
    },
    expectedRevision?: number
  ) => Promise<LocationRecord>;
  onDeleteLocation: (id: string, expectedRevision?: number) => Promise<void>;
}) {
  const id = useId();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingLoc, setEditingLoc] = useState<LocationRecord | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [actionMsg, setActionMsg] = useState("");

  return (
    <ModalDialog labelledBy={`${id}-loc-manage-title`} onClose={onClose}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
        <h2 id={`${id}-loc-manage-title`}>재배 장소 관리</h2>
        <button
          type="button"
          className="button secondary"
          style={{ fontSize: "0.85rem", padding: "0.35rem 0.6rem" }}
          onClick={() => {
            setErrorMsg("");
            setActionMsg("");
            setIsAddOpen(true);
          }}
        >
          <Plus size={15} aria-hidden="true" style={{ marginRight: "0.2rem" }} />
          새 장소 추가
        </button>
      </div>

      <p className="field-hint" style={{ marginBottom: "1rem" }}>
        식물이 자라는 공간의 빛, 비, 실내외 환경을 설정하고 관리합니다.
      </p>

      {actionMsg && (
        <p className="badge badge-neutral" style={{ display: "block", marginBottom: "0.75rem" }}>
          {actionMsg}
        </p>
      )}

      {errorMsg && (
        <p className="field-error" role="alert" style={{ marginBottom: "0.75rem" }}>
          {errorMsg}
        </p>
      )}

      {locations.length === 0 ? (
        <p style={{ color: "var(--muted)", margin: "1rem 0" }}>등록된 장소가 없습니다.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1rem" }}>
          {locations.map((loc) => (
            <div
              key={loc.id}
              className="card"
              style={{
                background: "var(--background)",
                padding: "0.75rem 1rem",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <strong>{loc.label}</strong>
                <span className="field-hint" style={{ display: "block" }}>
                  {loc.environmentType} · {loc.sunExposure} · {loc.rainfallExposure} · {loc.timeZone} (Rev: {loc.revision})
                </span>
              </div>
              <div className="button-row">
                <button
                  type="button"
                  className="button secondary"
                  style={{ padding: "0.3rem 0.5rem" }}
                  aria-label={`${loc.label} 수정`}
                  onClick={() => {
                    setErrorMsg("");
                    setActionMsg("");
                    setEditingLoc(loc);
                  }}
                >
                  <Edit2 size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="button secondary"
                  style={{ padding: "0.3rem 0.5rem", color: "var(--danger)" }}
                  aria-label={`${loc.label} 삭제`}
                  onClick={async () => {
                    if (window.confirm(`'${loc.label}' 장소를 휴지통으로 이동하시겠습니까?`)) {
                      try {
                        setErrorMsg("");
                        await onDeleteLocation(loc.id, loc.revision);
                        setActionMsg(`'${loc.label}' 장소를 휴지통으로 이동했습니다.`);
                      } catch (err) {
                        setErrorMsg(err instanceof Error ? err.message : String(err));
                      }
                    }
                  }}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="button-row">
        <button type="button" className="button" onClick={onClose}>
          닫기
        </button>
      </div>

      {isAddOpen && (
        <LocationFormDialog
          title="새 재배 장소 등록"
          onClose={() => setIsAddOpen(false)}
          onSubmit={async (values) => {
            await onAddLocation(values);
            setActionMsg(`'${values.label}' 장소를 등록했습니다.`);
            setIsAddOpen(false);
          }}
        />
      )}

      {editingLoc && (
        <LocationFormDialog
          title="재배 장소 수정"
          initialValues={editingLoc}
          onClose={() => setEditingLoc(null)}
          onSubmit={async (values) => {
            await onEditLocation(editingLoc.id, values, editingLoc.revision);
            setActionMsg(`'${values.label}' 장소를 수정했습니다.`);
            setEditingLoc(null);
          }}
        />
      )}
    </ModalDialog>
  );
}

//+_+// Reusable Location Form Dialog Component
function LocationFormDialog({
  title,
  initialValues,
  onClose,
  onSubmit,
}: {
  title: string;
  initialValues?: LocationRecord;
  onClose: () => void;
  onSubmit: (values: {
    label: string;
    environmentType: EnvironmentType;
    rainfallExposure: RainfallExposure;
    sunExposure: SunExposure;
    timeZone: string;
  }) => Promise<void>;
}) {
  const id = useId();
  const [label, setLabel] = useState(initialValues?.label ?? "");
  const [environmentType, setEnvironmentType] = useState<EnvironmentType>(
    initialValues?.environmentType ?? "INDOOR"
  );
  const [rainfallExposure, setRainfallExposure] = useState<RainfallExposure>(
    initialValues?.rainfallExposure ?? "COVERED"
  );
  const [sunExposure, setSunExposure] = useState<SunExposure>(
    initialValues?.sunExposure ?? "PARTIAL_SUN"
  );
  const [timeZone, setTimeZone] = useState(initialValues?.timeZone ?? "Asia/Seoul");
  const [errorMsg, setErrorMsg] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim()) {
      setErrorMsg("장소 이름을 입력해 주세요.");
      return;
    }
    try {
      setIsSubmitting(true);
      setErrorMsg("");
      await onSubmit({
        label: label.trim(),
        environmentType,
        rainfallExposure,
        sunExposure,
        timeZone: timeZone.trim(),
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setIsSubmitting(false);
    }
  };

  return (
    <ModalDialog labelledBy={`${id}-loc-title`} onClose={onClose}>
      <h2 id={`${id}-loc-title`}>{title}</h2>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {errorMsg && (
          <p className="field-error" role="alert">
            {errorMsg}
          </p>
        )}
        <div>
          <label htmlFor={`${id}-label`} style={{ display: "block", fontWeight: 600, marginBottom: "0.25rem" }}>
            장소 이름 *
          </label>
          <input
            id={`${id}-label`}
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="예: 거실 창가, 베란다 정원, 뒷마당"
            required
            autoFocus
          />
        </div>

        <div>
          <label htmlFor={`${id}-envType`} style={{ display: "block", fontWeight: 600, marginBottom: "0.25rem" }}>
            공간 환경 유형
          </label>
          <select
            id={`${id}-envType`}
            value={environmentType}
            onChange={(e) => setEnvironmentType(e.target.value as EnvironmentType)}
          >
            <option value="INDOOR">실내 (INDOOR)</option>
            <option value="BALCONY">베란다 (BALCONY)</option>
            <option value="OUTDOOR">야외/마당 (OUTDOOR)</option>
            <option value="GREENHOUSE">온실 (GREENHOUSE)</option>
          </select>
        </div>

        <div>
          <label htmlFor={`${id}-sun`} style={{ display: "block", fontWeight: 600, marginBottom: "0.25rem" }}>
            일조 조건
          </label>
          <select
            id={`${id}-sun`}
            value={sunExposure}
            onChange={(e) => setSunExposure(e.target.value as SunExposure)}
          >
            <option value="FULL_SUN">양지 (하루 종일 햇빛)</option>
            <option value="PARTIAL_SUN">반양지 (하루 3~5시간 햇빛)</option>
            <option value="SHADE">음지 (간접광)</option>
            <option value="ARTIFICIAL">식물생장등/인공조명</option>
          </select>
        </div>

        <div>
          <label htmlFor={`${id}-rain`} style={{ display: "block", fontWeight: 600, marginBottom: "0.25rem" }}>
            강수 노출
          </label>
          <select
            id={`${id}-rain`}
            value={rainfallExposure}
            onChange={(e) => setRainfallExposure(e.target.value as RainfallExposure)}
          >
            <option value="COVERED">지붕/실내 (비 안 맞음)</option>
            <option value="EXPOSED">완전 노출 (자연 강우)</option>
            <option value="SHELTERED">일부 차양</option>
          </select>
        </div>

        <div>
          <label htmlFor={`${id}-tz`} style={{ display: "block", fontWeight: 600, marginBottom: "0.25rem" }}>
            시간대 (IANA)
          </label>
          <input
            id={`${id}-tz`}
            type="text"
            value={timeZone}
            onChange={(e) => setTimeZone(e.target.value)}
            placeholder="Asia/Seoul"
            required
          />
        </div>

        <div className="button-row" style={{ marginTop: "0.5rem" }}>
          <button type="button" className="button secondary" onClick={onClose} disabled={isSubmitting}>
            취소
          </button>
          <button type="submit" className="button" disabled={isSubmitting}>
            {isSubmitting ? "저장 중..." : "장소 저장"}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}

export function PlantPreviewPage() {
  const [tab, setTab] = useState("타임라인");
  const descriptions: Record<string, string> = {
    타임라인: "관리 이벤트와 자유 일기를 통합해서 표시할 영역입니다.",
    "관리 계획": "실제 급수와 토양 관찰을 구별하는 관리 일정 영역입니다.",
    "성장 사진": "서로 다른 날짜의 사진을 비교할 영역입니다.",
    "식물 정보": "종·재배 장소·개체 또는 그룹·시즌 정보를 표시할 영역입니다.",
  };
  return (
    <PageContainer>
      <PageHeading
        eyebrow="개발용 레이아웃"
        title="식물 상세 미리보기"
        description="이 화면은 등록된 식물이 아니에요."
      />
      <PhaseNotice>
        개인 식물·시즌·관리 기록을 생성하거나 저장하지 않습니다.
      </PhaseNotice>
      <section className="card">
        <StatusBadge>데모 개체</StatusBadge>
        <h2>나의 첫 초록</h2>
        <dl className="detail-list">
          <div>
            <dt>재배 장소</dt>
            <dd>실내 (예시)</dd>
          </div>
          <div>
            <dt>재배 시작일</dt>
            <dd>미입력</dd>
          </div>
          <div>
            <dt>시즌</dt>
            <dd>등록 전</dd>
          </div>
        </dl>
        <div className="button-row">
          <Link className="button secondary" to="/check">
            상태 점검 안내
          </Link>
          <Link className="button secondary" to="/journal/new">
            일기 폼 미리보기
          </Link>
        </div>
      </section>
      <div className="segmented space-section" aria-label="식물 상세 보기">
        {Object.keys(descriptions).map((value) => (
          <button
            type="button"
            key={value}
            aria-pressed={tab === value}
            onClick={() => setTab(value)}
          >
            {value}
          </button>
        ))}
      </div>
      <section className="card space-section" aria-live="polite">
        <h2>{tab}</h2>
        <p>{descriptions[tab]}</p>
        <p className="muted">아직 저장된 데이터가 없어요.</p>
      </section>
    </PageContainer>
  );
}

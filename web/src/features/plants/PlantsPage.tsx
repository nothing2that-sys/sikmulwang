//+_+// P1 PlantsPage connected to IndexedDB for plant, location, group, and season CRUD
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
import { demoCatalog } from "../discover/demo-catalog";
import { useDb } from "../../lib/db/DbContext";
import type {
  PlantingRecord,
  GroupType,
  GrowingStatus,
  CycleRecord,
  EnvironmentHistoryRecord,
} from "../../lib/db/types";
import { getEnvironmentHistories } from "../../lib/db/plantingRepository";

export function PlantsPage() {
  const {
    locations,
    plantings,
    addPlanting,
    movePlanting,
    splitPlanting,
    changeQuantity,
    removePlanting,
    startNewCycle,
    finishCycle,
    getActiveCycleForPlanting,
    db,
    meta,
  } = useDb();

  const [selectedPlace, setSelectedPlace] = useState<string>("전체");
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [managingPlant, setManagingPlant] = useState<PlantingRecord | null>(null);

  //+_+// Filter plants by selected location label or '전체'
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
                  <p className="field-hint">{plant.quantityChangeReason}</p>
                )}
                <div className="button-row" style={{ marginTop: "0.75rem" }}>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => setManagingPlant(plant)}
                  >
                    관리하기
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      )}

      {/* Add Plant Modal */}
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

      {/* Manage Plant Modal */}
      {managingPlant && (
        <ManagePlantDialog
          plant={managingPlant}
          locations={locations}
          onClose={() => setManagingPlant(null)}
          onMove={async (newLocId) => {
            const updated = await movePlanting(managingPlant.id, newLocId);
            setManagingPlant(updated);
          }}
          onQuantityChange={async (newQty, reason) => {
            const updated = await changeQuantity(managingPlant.id, newQty, reason);
            setManagingPlant(updated);
          }}
          onSplitGroup={async (splitQty, newName, reason) => {
            const res = await splitPlanting(
              managingPlant.id,
              splitQty,
              newName,
              reason
            );
            setManagingPlant(res.source);
          }}
          onDelete={async () => {
            await removePlanting(managingPlant.id);
            setManagingPlant(null);
          }}
          getActiveCycle={() => getActiveCycleForPlanting(managingPlant.id)}
          onStartCycle={(startDate) => startNewCycle(managingPlant.id, startDate)}
          onEndCycle={(cycleId, endDate) => finishCycle(cycleId, endDate)}
          fetchHistories={() =>
            meta ? getEnvironmentHistories(db, meta.activeGenerationId, managingPlant.id) : Promise.resolve([])
          }
        />
      )}

      {/* Retain sample cards details for review and verification */}
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
  const [startLocalDate, setStartLocalDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
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
    <dialog
      open
      aria-labelledby={`${id}-title`}
      className="card"
      style={{ display: "block" }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
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
    </dialog>
  );
}

//+_+// Manage Plant Modal Dialog Component
function ManagePlantDialog({
  plant,
  locations,
  onClose,
  onMove,
  onQuantityChange,
  onSplitGroup,
  onDelete,
  getActiveCycle,
  onStartCycle,
  onEndCycle,
  fetchHistories,
}: {
  plant: PlantingRecord;
  locations: Array<{ id: string; label: string }>;
  onClose: () => void;
  onMove: (newLocationId: string) => Promise<void>;
  onQuantityChange: (newQuantity: number, reason: string) => Promise<void>;
  onSplitGroup: (splitQty: number, newName: string, reason: string) => Promise<void>;
  onDelete: () => Promise<void>;
  getActiveCycle: () => Promise<CycleRecord | undefined>;
  onStartCycle: (startDate: string) => Promise<CycleRecord>;
  onEndCycle: (cycleId: string, endDate: string) => Promise<CycleRecord>;
  fetchHistories: () => Promise<EnvironmentHistoryRecord[]>;
}) {
  const id = useId();
  const [activeCycle, setActiveCycle] = useState<CycleRecord | undefined>(undefined);
  const [histories, setHistories] = useState<EnvironmentHistoryRecord[]>([]);
  const [message, setMessage] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");

  // Sub-action states
  const [targetLocationId, setTargetLocationId] = useState(plant.locationId);
  const [qtyValue, setQtyValue] = useState(plant.quantity);
  const [qtyReason, setQtyReason] = useState("");
  const [splitQty, setSplitQty] = useState(1);
  const [splitName, setSplitName] = useState(`${plant.displayName} (분할)`);
  const [splitReason, setSplitReason] = useState("");
  const [newCycleDate, setNewCycleDate] = useState(new Date().toISOString().slice(0, 10));
  const [endCycleDate, setEndCycleDate] = useState(new Date().toISOString().slice(0, 10));

  useEffect(() => {
    getActiveCycle().then(setActiveCycle);
    fetchHistories().then(setHistories);
  }, [getActiveCycle, fetchHistories]);

  const currentLocation = locations.find((l) => l.id === plant.locationId);

  return (
    <dialog
      open
      aria-labelledby={`${id}-manage-title`}
      className="card"
      style={{ display: "block", maxHeight: "90vh", overflowY: "auto" }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <h2 id={`${id}-manage-title`}>{plant.displayName} 관리</h2>
      <p className="card-summary" style={{ marginBottom: "1rem" }}>
        현재 장소: <strong>{currentLocation?.label ?? "장소 미지정"}</strong> ·{" "}
        형태: <strong>{plant.groupType === "INDIVIDUAL" ? "개체 (1그루)" : `그룹 (${plant.quantity}${plant.unit})`}</strong>
      </p>

      {message && <p className="badge badge-neutral" style={{ display: "block", marginBottom: "0.5rem" }}>{message}</p>}
      {errorMsg && <p className="field-error" role="alert" style={{ marginBottom: "0.5rem" }}>{errorMsg}</p>}

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
                await onMove(targetLocationId);
                setMessage("장소를 성공적으로 이동했습니다.");
                fetchHistories().then(setHistories);
              } catch (err) {
                setErrorMsg(err instanceof Error ? err.message : String(err));
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
        <p className="field-hint">개체 폐기나 추가 식재로 인한 수량 변경 시 사유를 보존합니다.</p>
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
                await onQuantityChange(qtyValue, qtyReason);
                setMessage("수량이 성공적으로 변경되었습니다.");
                setQtyReason("");
              } catch (err) {
                setErrorMsg(err instanceof Error ? err.message : String(err));
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
            일부 개체를 독립 분리하여 새 planting으로 생성합니다. (남은 수량: {plant.quantity - splitQty})
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
                  await onSplitGroup(splitQty, splitName, splitReason);
                  setMessage("그룹을 분할하여 새 식물을 생성했습니다.");
                  setSplitQty(1);
                } catch (err) {
                  setErrorMsg(err instanceof Error ? err.message : String(err));
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
              현재 진행 중인 시즌: <strong>{activeCycle.startLocalDate} 시작</strong>
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
                    await onEndCycle(activeCycle.id, endCycleDate);
                    setMessage("시즌을 종료했습니다.");
                    getActiveCycle().then(setActiveCycle);
                  } catch (err) {
                    setErrorMsg(err instanceof Error ? err.message : String(err));
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
                    await onStartCycle(newCycleDate);
                    setMessage("새 시즌을 시작했습니다.");
                    getActiveCycle().then(setActiveCycle);
                  } catch (err) {
                    setErrorMsg(err instanceof Error ? err.message : String(err));
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

      {/* 6. 식물 삭제 (휴지통) */}
      <div className="button-row" style={{ marginTop: "1rem" }}>
        <button
          type="button"
          className="button secondary"
          style={{ color: "var(--danger)" }}
          onClick={async () => {
            if (window.confirm(`'${plant.displayName}' 식물을 휴지통으로 이동할까요?`)) {
              await onDelete();
            }
          }}
        >
          휴지통으로 이동
        </button>
        <button type="button" className="button" onClick={onClose}>
          닫기
        </button>
      </div>
    </dialog>
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

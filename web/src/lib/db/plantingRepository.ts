//+_+// Planting repository managing plantings, group splits, and environment history with optimistic concurrency
import type { SikmulwangDB } from "./database";
import type {
  EnvironmentHistoryRecord,
  GrowingStatus,
  GroupType,
  PlantingRecord,
  CycleRecord,
} from "./types";
import { withWriteTransaction } from "./transaction";
import { ConflictError, NotFoundError, ValidationError } from "./errors";
import {
  validateEffectiveTimestamp,
  validateExpectedRevision,
  validateLocalDate,
  validateQuantity,
} from "./validators";

export interface CreatePlantingParams {
  displayName: string;
  groupType: GroupType;
  quantity: number;
  unit?: string;
  locationId: string;
  growingStatus?: GrowingStatus;
  taxonSnapshotId?: string | null;
  startLocalDate?: string;
}

export interface UpdatePlantingParams {
  displayName?: string;
  unit?: string;
  growingStatus?: GrowingStatus;
  taxonSnapshotId?: string | null;
  expectedRevision: number;
}

const VALID_GROUP_TYPES: readonly GroupType[] = ["INDIVIDUAL", "GROUP"];
const VALID_GROWING_STATUSES: readonly GrowingStatus[] = [
  "GROWING",
  "HARVESTED",
  "DORMANT",
  "DEAD",
];

export async function listPlantings(
  db: SikmulwangDB,
  generationId: string,
  options: {
    locationId?: string;
    includeTrashed?: boolean;
    growingStatus?: GrowingStatus;
  } = {}
): Promise<PlantingRecord[]> {
  const query = db.plantings.where("generationId").equals(generationId);

  let items = await query.toArray();

  if (options.locationId) {
    items = items.filter((p) => p.locationId === options.locationId);
  }

  if (options.growingStatus) {
    items = items.filter((p) => p.growingStatus === options.growingStatus);
  }

  if (options.includeTrashed) {
    return items.filter((p) => p.recordStatus !== "PURGED");
  }

  return items.filter((p) => p.recordStatus === "ACTIVE");
}

export async function getPlantingById(
  db: SikmulwangDB,
  generationId: string,
  id: string
): Promise<PlantingRecord | undefined> {
  const item = await db.plantings.get([generationId, id]);
  if (!item || item.recordStatus === "PURGED") return undefined;
  return item;
}

export async function createPlanting(
  db: SikmulwangDB,
  sessionEpoch: number,
  sessionGenerationId: string,
  params: CreatePlantingParams
): Promise<{ planting: PlantingRecord; cycle?: CycleRecord }> {
  if (!params.displayName || !params.displayName.trim()) {
    throw new ValidationError("식물 이름을 입력해 주세요.");
  }
  if (!VALID_GROUP_TYPES.includes(params.groupType)) {
    throw new ValidationError(`올바르지 않은 관리 형태입니다: ${params.groupType}`);
  }

  validateQuantity(params.quantity, params.groupType);

  if (params.growingStatus && !VALID_GROWING_STATUSES.includes(params.growingStatus)) {
    throw new ValidationError(`올바르지 않은 생육 상태입니다: ${params.growingStatus}`);
  }

  if (params.startLocalDate) {
    validateLocalDate(params.startLocalDate, "시즌 시작일");
  }

  if (params.taxonSnapshotId !== undefined && params.taxonSnapshotId !== null) {
    if (typeof params.taxonSnapshotId !== "string" || !params.taxonSnapshotId.trim()) {
      throw new ValidationError("올바르지 않은 분류 스냅샷 ID입니다.");
    }
  }

  const plantingId = `plt_${crypto.randomUUID()}`;
  const envHistoryId = `envh_${crypto.randomUUID()}`;
  const cycleId = params.startLocalDate ? `cyc_${crypto.randomUUID()}` : undefined;

  return await withWriteTransaction(
    db,
    [db.plantings, db.environmentHistory, db.locations, db.cycles, db.taxonSnapshots],
    sessionEpoch,
    sessionGenerationId,
    async ({ generationId, nowUtc }) => {
      //+_+// Verify taxon snapshot existence in the active generation if provided
      if (params.taxonSnapshotId) {
        const taxon = await db.taxonSnapshots.get([generationId, params.taxonSnapshotId]);
        if (!taxon) {
          throw new NotFoundError(
            `지정된 분류 스냅샷을 찾을 수 없습니다: ${params.taxonSnapshotId}`
          );
        }
      }

      //+_+// Verify location existence and ensure it is not trashed or purged
      const loc = await db.locations.get([generationId, params.locationId]);
      if (!loc || loc.recordStatus === "PURGED") {
        throw new NotFoundError(
          `지정된 장소를 찾을 수 없습니다: ${params.locationId}`
        );
      }
      if (loc.recordStatus === "TRASHED") {
        throw new ValidationError("휴지통에 있는 장소에는 식물을 등록할 수 없습니다.");
      }

      const planting: PlantingRecord = {
        generationId,
        id: plantingId,
        taxonSnapshotId: params.taxonSnapshotId ?? null,
        displayName: params.displayName.trim(),
        groupType: params.groupType,
        quantity: params.quantity,
        unit: params.unit?.trim() || (params.groupType === "GROUP" ? "개" : "그루"),
        locationId: params.locationId,
        growingStatus: params.growingStatus ?? "GROWING",
        recordStatus: "ACTIVE",
        splitFromPlantingId: null,
        quantityChangeReason: null,
        createdAt: nowUtc,
        updatedAt: nowUtc,
        revision: 1,
        schemaVersion: 1,
      };

      const envHistory: EnvironmentHistoryRecord = {
        generationId,
        id: envHistoryId,
        plantingId,
        locationId: loc.id,
        validFrom: nowUtc,
        validTo: null,
        environmentSnapshot: {
          label: loc.label,
          environmentType: loc.environmentType,
          rainfallExposure: loc.rainfallExposure,
          sunExposure: loc.sunExposure,
          timeZone: loc.timeZone,
        },
        recordStatus: "ACTIVE",
        createdAt: nowUtc,
        updatedAt: nowUtc,
        revision: 1,
        schemaVersion: 1,
      };

      await db.plantings.put(planting);
      await db.environmentHistory.put(envHistory);

      let createdCycle: CycleRecord | undefined;
      if (params.startLocalDate && cycleId) {
        createdCycle = {
          generationId,
          id: cycleId,
          plantingId,
          startLocalDate: params.startLocalDate,
          endLocalDate: null,
          timeZone: loc.timeZone,
          status: "ACTIVE",
          recordStatus: "ACTIVE",
          createdAt: nowUtc,
          updatedAt: nowUtc,
          revision: 1,
          schemaVersion: 1,
        };
        await db.cycles.put(createdCycle);
      }

      return { planting, cycle: createdCycle };
    }
  );
}

export async function updatePlanting(
  db: SikmulwangDB,
  sessionEpoch: number,
  sessionGenerationId: string,
  id: string,
  updates: UpdatePlantingParams
): Promise<PlantingRecord> {
  const expectedRevision = validateExpectedRevision(updates.expectedRevision);

  if (updates.displayName !== undefined && !updates.displayName.trim()) {
    throw new ValidationError("식물 이름을 비워둘 수 없습니다.");
  }
  if (
    updates.growingStatus !== undefined &&
    !VALID_GROWING_STATUSES.includes(updates.growingStatus)
  ) {
    throw new ValidationError(`올바르지 않은 생육 상태입니다: ${updates.growingStatus}`);
  }

  if (updates.taxonSnapshotId !== undefined && updates.taxonSnapshotId !== null) {
    if (typeof updates.taxonSnapshotId !== "string" || !updates.taxonSnapshotId.trim()) {
      throw new ValidationError("올바르지 않은 분류 스냅샷 ID입니다.");
    }
  }

  return await withWriteTransaction(
    db,
    [db.plantings, db.taxonSnapshots],
    sessionEpoch,
    sessionGenerationId,
    async ({ generationId, nowUtc }) => {
      const existing = await db.plantings.get([generationId, id]);
      if (!existing || existing.recordStatus === "PURGED") {
        throw new NotFoundError(`식물을 찾을 수 없습니다: ${id}`);
      }

      if (existing.revision !== expectedRevision) {
        throw new ConflictError(
          `식물 수정 충돌: 현재 revision(${existing.revision})이 기대값(${expectedRevision})과 다릅니다.`,
          existing.revision,
          expectedRevision
        );
      }

      //+_+// Verify taxon snapshot existence if updated and not null
      if (updates.taxonSnapshotId) {
        const taxon = await db.taxonSnapshots.get([generationId, updates.taxonSnapshotId]);
        if (!taxon) {
          throw new NotFoundError(
            `지정된 분류 스냅샷을 찾을 수 없습니다: ${updates.taxonSnapshotId}`
          );
        }
      }

      const updated: PlantingRecord = {
        ...existing,
        displayName:
          updates.displayName !== undefined
            ? updates.displayName.trim()
            : existing.displayName,
        unit: updates.unit !== undefined ? updates.unit.trim() : existing.unit,
        growingStatus: updates.growingStatus ?? existing.growingStatus,
        taxonSnapshotId:
          updates.taxonSnapshotId !== undefined
            ? updates.taxonSnapshotId
            : existing.taxonSnapshotId,
        updatedAt: nowUtc,
        revision: existing.revision + 1,
      };

      await db.plantings.put(updated);
      return updated;
    }
  );
}

export async function movePlantingLocation(
  db: SikmulwangDB,
  sessionEpoch: number,
  sessionGenerationId: string,
  plantingId: string,
  newLocationId: string,
  effectiveAt: string | undefined,
  expectedRevision: number
): Promise<PlantingRecord> {
  const validExpectedRev = validateExpectedRevision(expectedRevision);
  if (effectiveAt !== undefined) {
    validateEffectiveTimestamp(effectiveAt, "장소 이동 시각");
  }

  return await withWriteTransaction(
    db,
    [db.plantings, db.environmentHistory, db.locations],
    sessionEpoch,
    sessionGenerationId,
    async ({ generationId, nowUtc }) => {
      const planting = await db.plantings.get([generationId, plantingId]);
      if (!planting || planting.recordStatus === "PURGED") {
        throw new NotFoundError(`식물을 찾을 수 없습니다: ${plantingId}`);
      }

      if (planting.revision !== validExpectedRev) {
        throw new ConflictError(
          `식물 장소 이동 충돌: 현재 revision(${planting.revision})이 기대값(${validExpectedRev})과 다릅니다.`,
          planting.revision,
          validExpectedRev
        );
      }

      const targetLoc = await db.locations.get([generationId, newLocationId]);
      if (!targetLoc || targetLoc.recordStatus === "PURGED") {
        throw new NotFoundError(
          `이동할 장소를 찾을 수 없습니다: ${newLocationId}`
        );
      }
      if (targetLoc.recordStatus === "TRASHED") {
        throw new ValidationError("휴지통에 있는 장소로는 이동할 수 없습니다.");
      }

      const moveTime = effectiveAt ?? nowUtc;

      //+_+// Close existing active environment history and validate monotonic timeline
      const existingHistories = await db.environmentHistory
        .where("generationId")
        .equals(generationId)
        .filter((h) => h.plantingId === plantingId && h.validTo === null)
        .toArray();

      for (const history of existingHistories) {
        if (new Date(moveTime).getTime() < new Date(history.validFrom).getTime()) {
          throw new ValidationError(
            `장소 이동 시각(${moveTime})은 기존 환경 이력의 시작 시각(${history.validFrom})보다 앞설 수 없습니다.`
          );
        }

        await db.environmentHistory.put({
          ...history,
          validTo: moveTime,
          updatedAt: nowUtc,
          revision: history.revision + 1,
        });
      }

      //+_+// Create new environment history
      const newHistoryId = `envh_${crypto.randomUUID()}`;
      const newHistory: EnvironmentHistoryRecord = {
        generationId,
        id: newHistoryId,
        plantingId,
        locationId: newLocationId,
        validFrom: moveTime,
        validTo: null,
        environmentSnapshot: {
          label: targetLoc.label,
          environmentType: targetLoc.environmentType,
          rainfallExposure: targetLoc.rainfallExposure,
          sunExposure: targetLoc.sunExposure,
          timeZone: targetLoc.timeZone,
        },
        recordStatus: "ACTIVE",
        createdAt: nowUtc,
        updatedAt: nowUtc,
        revision: 1,
        schemaVersion: 1,
      };
      await db.environmentHistory.put(newHistory);

      //+_+// Update planting location
      const updatedPlanting: PlantingRecord = {
        ...planting,
        locationId: newLocationId,
        updatedAt: nowUtc,
        revision: planting.revision + 1,
      };
      await db.plantings.put(updatedPlanting);

      return updatedPlanting;
    }
  );
}

export async function splitPlantingGroup(
  db: SikmulwangDB,
  sessionEpoch: number,
  sessionGenerationId: string,
  sourcePlantingId: string,
  splitQuantity: number,
  expectedRevision: number,
  newDisplayName?: string,
  reason?: string
): Promise<{ source: PlantingRecord; split: PlantingRecord }> {
  const validExpectedRev = validateExpectedRevision(expectedRevision);

  if (
    typeof splitQuantity !== "number" ||
    !Number.isFinite(splitQuantity) ||
    !Number.isInteger(splitQuantity) ||
    splitQuantity <= 0
  ) {
    throw new ValidationError("분할 수량은 1 이상의 정수여야 합니다.");
  }

  const splitId = `plt_${crypto.randomUUID()}`;
  const splitEnvHistoryId = `envh_${crypto.randomUUID()}`;

  return await withWriteTransaction(
    db,
    [db.plantings, db.environmentHistory, db.locations],
    sessionEpoch,
    sessionGenerationId,
    async ({ generationId, nowUtc }) => {
      const source = await db.plantings.get([generationId, sourcePlantingId]);
      if (!source || source.recordStatus === "PURGED") {
        throw new NotFoundError(
          `원본 식물을 찾을 수 없습니다: ${sourcePlantingId}`
        );
      }

      if (source.revision !== validExpectedRev) {
        throw new ConflictError(
          `그룹 분할 충돌: 현재 revision(${source.revision})이 기대값(${validExpectedRev})과 다릅니다.`,
          source.revision,
          validExpectedRev
        );
      }

      if (source.groupType !== "GROUP") {
        throw new ValidationError("개체 식물은 분할할 수 없습니다.");
      }
      if (source.quantity <= splitQuantity) {
        throw new ValidationError(
          `분할 수량(${splitQuantity})은 원본 수량(${source.quantity})보다 작아야 합니다.`
        );
      }

      const splitReason = reason?.trim() || "그룹 분할로 인한 분리";
      const formattedReason = `[${nowUtc}] 분할로 인한 수량 감소 (${splitQuantity}${source.unit} 분리: ${splitReason})`;
      const updatedSourceReason = source.quantityChangeReason
        ? `${source.quantityChangeReason}\n${formattedReason}`
        : formattedReason;

      //+_+// 1. Update source with reason history preserved
      const updatedSource: PlantingRecord = {
        ...source,
        quantity: source.quantity - splitQuantity,
        quantityChangeReason: updatedSourceReason,
        updatedAt: nowUtc,
        revision: source.revision + 1,
      };
      await db.plantings.put(updatedSource);

      //+_+// 2. Fetch location for snapshot
      const loc = await db.locations.get([generationId, source.locationId]);
      if (!loc) {
        throw new NotFoundError(`장소를 찾을 수 없습니다: ${source.locationId}`);
      }

      //+_+// 3. Create split planting
      const splitPlanting: PlantingRecord = {
        generationId,
        id: splitId,
        taxonSnapshotId: source.taxonSnapshotId,
        displayName: newDisplayName?.trim() || `${source.displayName} (분할)`,
        groupType: splitQuantity > 1 ? "GROUP" : "INDIVIDUAL",
        quantity: splitQuantity,
        unit: source.unit,
        locationId: source.locationId,
        growingStatus: source.growingStatus,
        recordStatus: "ACTIVE",
        splitFromPlantingId: sourcePlantingId,
        quantityChangeReason: `[${nowUtc}] 원본 '${source.displayName}'에서 분할 생성: ${splitReason}`,
        createdAt: nowUtc,
        updatedAt: nowUtc,
        revision: 1,
        schemaVersion: 1,
      };
      await db.plantings.put(splitPlanting);

      //+_+// 4. Create initial environment history for split planting
      const splitEnvHistory: EnvironmentHistoryRecord = {
        generationId,
        id: splitEnvHistoryId,
        plantingId: splitId,
        locationId: loc.id,
        validFrom: nowUtc,
        validTo: null,
        environmentSnapshot: {
          label: loc.label,
          environmentType: loc.environmentType,
          rainfallExposure: loc.rainfallExposure,
          sunExposure: loc.sunExposure,
          timeZone: loc.timeZone,
        },
        recordStatus: "ACTIVE",
        createdAt: nowUtc,
        updatedAt: nowUtc,
        revision: 1,
        schemaVersion: 1,
      };
      await db.environmentHistory.put(splitEnvHistory);

      return { source: updatedSource, split: splitPlanting };
    }
  );
}

export async function changePlantingQuantity(
  db: SikmulwangDB,
  sessionEpoch: number,
  sessionGenerationId: string,
  plantingId: string,
  newQuantity: number,
  reason: string,
  expectedRevision: number
): Promise<PlantingRecord> {
  const validExpectedRev = validateExpectedRevision(expectedRevision);

  if (!reason || !reason.trim()) {
    throw new ValidationError("수량 변경 사유를 입력해 주세요.");
  }

  return await withWriteTransaction(
    db,
    [db.plantings],
    sessionEpoch,
    sessionGenerationId,
    async ({ generationId, nowUtc }) => {
      const existing = await db.plantings.get([generationId, plantingId]);
      if (!existing || existing.recordStatus === "PURGED") {
        throw new NotFoundError(`식물을 찾을 수 없습니다: ${plantingId}`);
      }

      if (existing.revision !== validExpectedRev) {
        throw new ConflictError(
          `수량 변경 충돌: 현재 revision(${existing.revision})이 기대값(${validExpectedRev})과 다릅니다.`,
          existing.revision,
          validExpectedRev
        );
      }

      validateQuantity(newQuantity, existing.groupType);

      const formattedReason = `[${nowUtc}] (${existing.quantity} -> ${newQuantity}) ${reason.trim()}`;
      const accumulatedReason = existing.quantityChangeReason
        ? `${existing.quantityChangeReason}\n${formattedReason}`
        : formattedReason;

      const updated: PlantingRecord = {
        ...existing,
        quantity: newQuantity,
        quantityChangeReason: accumulatedReason,
        updatedAt: nowUtc,
        revision: existing.revision + 1,
      };

      await db.plantings.put(updated);
      return updated;
    }
  );
}

export async function trashPlanting(
  db: SikmulwangDB,
  sessionEpoch: number,
  sessionGenerationId: string,
  id: string,
  expectedRevision: number
): Promise<void> {
  const validExpectedRev = validateExpectedRevision(expectedRevision);

  await withWriteTransaction(
    db,
    [db.plantings],
    sessionEpoch,
    sessionGenerationId,
    async ({ generationId, nowUtc }) => {
      const existing = await db.plantings.get([generationId, id]);
      if (!existing || existing.recordStatus === "PURGED") {
        throw new NotFoundError(`식물을 찾을 수 없습니다: ${id}`);
      }

      if (existing.revision !== validExpectedRev) {
        throw new ConflictError(
          `식물 휴지통 이동 충돌: 현재 revision(${existing.revision})이 기대값(${validExpectedRev})과 다릅니다.`,
          existing.revision,
          validExpectedRev
        );
      }

      await db.plantings.put({
        ...existing,
        recordStatus: "TRASHED",
        updatedAt: nowUtc,
        revision: existing.revision + 1,
      });
    }
  );
}

export async function restorePlanting(
  db: SikmulwangDB,
  sessionEpoch: number,
  sessionGenerationId: string,
  id: string,
  expectedRevision: number
): Promise<void> {
  const validExpectedRev = validateExpectedRevision(expectedRevision);

  await withWriteTransaction(
    db,
    [db.plantings, db.locations],
    sessionEpoch,
    sessionGenerationId,
    async ({ generationId, nowUtc }) => {
      const existing = await db.plantings.get([generationId, id]);
      if (!existing || existing.recordStatus === "PURGED") {
        throw new NotFoundError(`식물을 찾을 수 없습니다: ${id}`);
      }

      if (existing.revision !== validExpectedRev) {
        throw new ConflictError(
          `식물 복원 충돌: 현재 revision(${existing.revision})이 기대값(${validExpectedRev})과 다릅니다.`,
          existing.revision,
          validExpectedRev
        );
      }

      // Check whether planting's location still exists
      const loc = await db.locations.get([generationId, existing.locationId]);
      if (!loc || loc.recordStatus === "PURGED") {
        throw new ValidationError(
          "식물이 속해 있던 재배 장소가 영구 삭제되어 복원할 수 없습니다. 새 장소를 지정해야 합니다."
        );
      }

      await db.plantings.put({
        ...existing,
        recordStatus: "ACTIVE",
        updatedAt: nowUtc,
        revision: existing.revision + 1,
      });
    }
  );
}

export async function purgePlanting(
  db: SikmulwangDB,
  sessionEpoch: number,
  sessionGenerationId: string,
  id: string,
  expectedRevision: number
): Promise<void> {
  const validExpectedRev = validateExpectedRevision(expectedRevision);

  await withWriteTransaction(
    db,
    [db.plantings, db.environmentHistory, db.cycles, db.careEvents, db.observations, db.taskOccurrences, db.careRules, db.diaries, db.mediaLinks],
    sessionEpoch,
    sessionGenerationId,
    async ({ generationId }) => {
      const existing = await db.plantings.get([generationId, id]);
      if (!existing) {
        return;
      }

      if (existing.revision !== validExpectedRev) {
        throw new ConflictError(
          `식물 영구 삭제 충돌: 현재 revision(${existing.revision})이 기대값(${validExpectedRev})과 다릅니다.`,
          existing.revision,
          validExpectedRev
        );
      }

      const linkedCycles = await db.cycles.where('generationId').equals(generationId).filter(c => c.plantingId === id).primaryKeys();
      const cycleIds = new Set(linkedCycles.map(key => key[1]));
      //+_+// P2 history must not be orphaned by the P1 physical purge path.
      for (const store of [db.careEvents, db.observations, db.taskOccurrences, db.careRules]) {
        if ((await store.where('generationId').equals(generationId).toArray()).some(r => cycleIds.has(r.cycleId))) {
          throw new ValidationError('관리 이력이 있는 식물은 영구 삭제할 수 없습니다. 휴지통에 보존해 주세요.');
        }
      }
      if ((await db.diaries.where('generationId').equals(generationId).toArray()).some(r => cycleIds.has(r.cycleId)) ||
          (await db.mediaLinks.where('generationId').equals(generationId).toArray()).some(r => r.ownerType === 'PLANTING' && r.ownerId === id)) {
        throw new ValidationError('일기·사진이 있는 식물은 휴지통에 보존해 주세요.');
      }
      await db.plantings.delete([generationId, id]);

      //+_+// Purge linked environment histories and cycles
      const envHistories = await db.environmentHistory
        .where("generationId")
        .equals(generationId)
        .filter((h) => h.plantingId === id)
        .toArray();
      for (const h of envHistories) {
        await db.environmentHistory.delete([generationId, h.id]);
      }

      const cycles = await db.cycles
        .where("generationId")
        .equals(generationId)
        .filter((c) => c.plantingId === id)
        .toArray();
      for (const c of cycles) {
        await db.cycles.delete([generationId, c.id]);
      }
    }
  );
}

export async function getEnvironmentHistories(
  db: SikmulwangDB,
  generationId: string,
  plantingId: string
): Promise<EnvironmentHistoryRecord[]> {
  return await db.environmentHistory
    .where("generationId")
    .equals(generationId)
    .filter((h) => h.plantingId === plantingId && h.recordStatus !== "PURGED")
    .reverse()
    .sortBy("validFrom");
}

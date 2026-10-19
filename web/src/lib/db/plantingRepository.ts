//+_+// Planting repository managing plantings, group splits, and environment history
import type { SikmulwangDB } from "./database";
import type {
  EnvironmentHistoryRecord,
  GrowingStatus,
  GroupType,
  PlantingRecord,
  CycleRecord,
} from "./types";
import { withWriteTransaction } from "./transaction";
import { NotFoundError, ValidationError } from "./errors";

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
}

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
  if (!params.displayName.trim()) {
    throw new ValidationError("식물 이름을 입력해 주세요.");
  }
  if (params.quantity <= 0) {
    throw new ValidationError("수량은 1 이상이어야 합니다.");
  }

  const plantingId = `plt_${crypto.randomUUID()}`;
  const envHistoryId = `envh_${crypto.randomUUID()}`;
  const cycleId = params.startLocalDate ? `cyc_${crypto.randomUUID()}` : undefined;

  return await withWriteTransaction(
    db,
    [db.plantings, db.environmentHistory, db.locations, db.cycles],
    sessionEpoch,
    sessionGenerationId,
    async ({ generationId, nowUtc }) => {
      //+_+// Verify location existence and snapshot
      const loc = await db.locations.get([generationId, params.locationId]);
      if (!loc || loc.recordStatus === "PURGED") {
        throw new NotFoundError(
          `지정된 장소를 찾을 수 없습니다: ${params.locationId}`
        );
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
  return await withWriteTransaction(
    db,
    [db.plantings],
    sessionEpoch,
    sessionGenerationId,
    async ({ generationId, nowUtc }) => {
      const existing = await db.plantings.get([generationId, id]);
      if (!existing || existing.recordStatus === "PURGED") {
        throw new NotFoundError(`식물을 찾을 수 없습니다: ${id}`);
      }

      if (updates.displayName !== undefined && !updates.displayName.trim()) {
        throw new ValidationError("식물 이름을 비워둘 수 없습니다.");
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
  effectiveAt?: string
): Promise<PlantingRecord> {
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

      const targetLoc = await db.locations.get([generationId, newLocationId]);
      if (!targetLoc || targetLoc.recordStatus === "PURGED") {
        throw new NotFoundError(
          `이동할 장소를 찾을 수 없습니다: ${newLocationId}`
        );
      }

      const moveTime = effectiveAt ?? nowUtc;

      //+_+// Close existing active environment history
      const existingHistories = await db.environmentHistory
        .where("generationId")
        .equals(generationId)
        .filter((h) => h.plantingId === plantingId && h.validTo === null)
        .toArray();

      for (const history of existingHistories) {
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
  newDisplayName?: string,
  reason?: string
): Promise<{ source: PlantingRecord; split: PlantingRecord }> {
  if (splitQuantity <= 0) {
    throw new ValidationError("분할 수량은 1 이상이어야 합니다.");
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
      if (source.groupType !== "GROUP") {
        throw new ValidationError("개체 식물은 분할할 수 없습니다.");
      }
      if (source.quantity <= splitQuantity) {
        throw new ValidationError(
          `분할 수량(${splitQuantity})은 원본 수량(${source.quantity})보다 작아야 합니다.`
        );
      }

      const splitReason = reason?.trim() || "그룹 분할로 인한 분리";

      //+_+// 1. Update source
      const updatedSource: PlantingRecord = {
        ...source,
        quantity: source.quantity - splitQuantity,
        quantityChangeReason: `분할로 인한 수량 감소 (${splitQuantity}${source.unit} 분리)`,
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
        quantityChangeReason: `원본 '${source.displayName}'에서 분할 생성: ${splitReason}`,
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
  reason: string
): Promise<PlantingRecord> {
  if (newQuantity <= 0) {
    throw new ValidationError("수량은 1 이상이어야 합니다.");
  }
  if (!reason.trim()) {
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

      const updated: PlantingRecord = {
        ...existing,
        quantity: newQuantity,
        quantityChangeReason: reason.trim(),
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
  id: string
): Promise<void> {
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
  id: string
): Promise<void> {
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
  id: string
): Promise<void> {
  await withWriteTransaction(
    db,
    [db.plantings, db.environmentHistory, db.cycles],
    sessionEpoch,
    sessionGenerationId,
    async ({ generationId }) => {
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

//+_+// Location repository with generation-scoped keys, validation, and optimistic concurrency
import type { SikmulwangDB } from "./database";
import type {
  EnvironmentType,
  LocationRecord,
  RainfallExposure,
  SunExposure,
} from "./types";
import { withWriteTransaction } from "./transaction";
import { ConflictError, NotFoundError, ValidationError } from "./errors";
import { validateTimeZone } from "./validators";

export interface CreateLocationParams {
  label: string;
  environmentType: EnvironmentType;
  rainfallExposure: RainfallExposure;
  sunExposure: SunExposure;
  timeZone?: string;
}

export interface UpdateLocationParams {
  label?: string;
  environmentType?: EnvironmentType;
  rainfallExposure?: RainfallExposure;
  sunExposure?: SunExposure;
  timeZone?: string;
  expectedRevision?: number;
}

const VALID_ENV_TYPES: readonly EnvironmentType[] = [
  "INDOOR",
  "BALCONY",
  "OUTDOOR",
  "GREENHOUSE",
];
const VALID_RAINFALL: readonly RainfallExposure[] = [
  "COVERED",
  "EXPOSED",
  "SHELTERED",
];
const VALID_SUN: readonly SunExposure[] = [
  "FULL_SUN",
  "PARTIAL_SUN",
  "SHADE",
  "ARTIFICIAL",
];

export async function listLocations(
  db: SikmulwangDB,
  generationId: string,
  options: { includeTrashed?: boolean } = {}
): Promise<LocationRecord[]> {
  const allInGen = await db.locations
    .where("generationId")
    .equals(generationId)
    .toArray();

  if (options.includeTrashed) {
    return allInGen.filter((loc) => loc.recordStatus !== "PURGED");
  }

  return allInGen.filter((loc) => loc.recordStatus === "ACTIVE");
}

export async function getLocationById(
  db: SikmulwangDB,
  generationId: string,
  id: string
): Promise<LocationRecord | undefined> {
  const loc = await db.locations.get([generationId, id]);
  if (!loc || loc.recordStatus === "PURGED") return undefined;
  return loc;
}

export async function createLocation(
  db: SikmulwangDB,
  sessionEpoch: number,
  sessionGenerationId: string,
  params: CreateLocationParams
): Promise<LocationRecord> {
  if (!params.label.trim()) {
    throw new ValidationError("장소 이름을 입력해 주세요.");
  }

  if (!VALID_ENV_TYPES.includes(params.environmentType)) {
    throw new ValidationError(`올바르지 않은 환경 유형입니다: ${params.environmentType}`);
  }
  if (!VALID_RAINFALL.includes(params.rainfallExposure)) {
    throw new ValidationError(`올바르지 않은 강수 노출입니다: ${params.rainfallExposure}`);
  }
  if (!VALID_SUN.includes(params.sunExposure)) {
    throw new ValidationError(`올바르지 않은 일조 조건입니다: ${params.sunExposure}`);
  }

  const tz = params.timeZone ?? "Asia/Seoul";
  validateTimeZone(tz);

  const id = `loc_${crypto.randomUUID()}`;

  return await withWriteTransaction(
    db,
    [db.locations],
    sessionEpoch,
    sessionGenerationId,
    async ({ generationId, nowUtc }) => {
      const record: LocationRecord = {
        generationId,
        id,
        label: params.label.trim(),
        environmentType: params.environmentType,
        rainfallExposure: params.rainfallExposure,
        sunExposure: params.sunExposure,
        timeZone: tz,
        recordStatus: "ACTIVE",
        createdAt: nowUtc,
        updatedAt: nowUtc,
        revision: 1,
        schemaVersion: 1,
      };

      await db.locations.put(record);
      return record;
    }
  );
}

export async function updateLocation(
  db: SikmulwangDB,
  sessionEpoch: number,
  sessionGenerationId: string,
  id: string,
  updates: UpdateLocationParams
): Promise<LocationRecord> {
  if (updates.label !== undefined && !updates.label.trim()) {
    throw new ValidationError("장소 이름을 비워둘 수 없습니다.");
  }
  if (updates.environmentType && !VALID_ENV_TYPES.includes(updates.environmentType)) {
    throw new ValidationError(`올바르지 않은 환경 유형입니다: ${updates.environmentType}`);
  }
  if (updates.rainfallExposure && !VALID_RAINFALL.includes(updates.rainfallExposure)) {
    throw new ValidationError(`올바르지 않은 강수 노출입니다: ${updates.rainfallExposure}`);
  }
  if (updates.sunExposure && !VALID_SUN.includes(updates.sunExposure)) {
    throw new ValidationError(`올바르지 않은 일조 조건입니다: ${updates.sunExposure}`);
  }
  if (updates.timeZone !== undefined) {
    validateTimeZone(updates.timeZone);
  }

  return await withWriteTransaction(
    db,
    [db.locations],
    sessionEpoch,
    sessionGenerationId,
    async ({ generationId, nowUtc }) => {
      const existing = await db.locations.get([generationId, id]);
      if (!existing || existing.recordStatus === "PURGED") {
        throw new NotFoundError(`장소를 찾을 수 없습니다: ${id}`);
      }

      if (
        updates.expectedRevision !== undefined &&
        existing.revision !== updates.expectedRevision
      ) {
        throw new ConflictError(
          `장소 수정 충돌: 현재 revision(${existing.revision})이 기대값(${updates.expectedRevision})과 다릅니다.`,
          existing.revision,
          updates.expectedRevision
        );
      }

      const updated: LocationRecord = {
        ...existing,
        label: updates.label !== undefined ? updates.label.trim() : existing.label,
        environmentType: updates.environmentType ?? existing.environmentType,
        rainfallExposure: updates.rainfallExposure ?? existing.rainfallExposure,
        sunExposure: updates.sunExposure ?? existing.sunExposure,
        timeZone: updates.timeZone ?? existing.timeZone,
        updatedAt: nowUtc,
        revision: existing.revision + 1,
      };

      await db.locations.put(updated);
      return updated;
    }
  );
}

export async function trashLocation(
  db: SikmulwangDB,
  sessionEpoch: number,
  sessionGenerationId: string,
  id: string,
  expectedRevision?: number
): Promise<void> {
  await withWriteTransaction(
    db,
    [db.locations, db.plantings],
    sessionEpoch,
    sessionGenerationId,
    async ({ generationId, nowUtc }) => {
      const existing = await db.locations.get([generationId, id]);
      if (!existing || existing.recordStatus === "PURGED") {
        throw new NotFoundError(`장소를 찾을 수 없습니다: ${id}`);
      }

      if (
        expectedRevision !== undefined &&
        existing.revision !== expectedRevision
      ) {
        throw new ConflictError(
          `장소 휴지통 이동 충돌: 현재 revision(${existing.revision})이 기대값(${expectedRevision})과 다릅니다.`,
          existing.revision,
          expectedRevision
        );
      }

      // Check whether active plantings reference this location
      const activePlanting = await db.plantings
        .where("generationId")
        .equals(generationId)
        .filter((p) => p.locationId === id && p.recordStatus === "ACTIVE")
        .first();

      if (activePlanting) {
        throw new ValidationError(
          `해당 장소('${existing.label}')를 사용 중인 식물('${activePlanting.displayName}')이 있어 휴지통으로 이동할 수 없습니다. 식물을 다른 장소로 이동한 후 시도해 주세요.`
        );
      }

      await db.locations.put({
        ...existing,
        recordStatus: "TRASHED",
        updatedAt: nowUtc,
        revision: existing.revision + 1,
      });
    }
  );
}

export async function restoreLocation(
  db: SikmulwangDB,
  sessionEpoch: number,
  sessionGenerationId: string,
  id: string,
  expectedRevision?: number
): Promise<void> {
  await withWriteTransaction(
    db,
    [db.locations],
    sessionEpoch,
    sessionGenerationId,
    async ({ generationId, nowUtc }) => {
      const existing = await db.locations.get([generationId, id]);
      if (!existing || existing.recordStatus === "PURGED") {
        throw new NotFoundError(`장소를 찾을 수 없습니다: ${id}`);
      }

      if (
        expectedRevision !== undefined &&
        existing.revision !== expectedRevision
      ) {
        throw new ConflictError(
          `장소 복원 충돌: 현재 revision(${existing.revision})이 기대값(${expectedRevision})과 다릅니다.`,
          existing.revision,
          expectedRevision
        );
      }

      await db.locations.put({
        ...existing,
        recordStatus: "ACTIVE",
        updatedAt: nowUtc,
        revision: existing.revision + 1,
      });
    }
  );
}

export async function purgeLocation(
  db: SikmulwangDB,
  sessionEpoch: number,
  sessionGenerationId: string,
  id: string,
  expectedRevision?: number
): Promise<void> {
  await withWriteTransaction(
    db,
    [db.locations, db.plantings],
    sessionEpoch,
    sessionGenerationId,
    async ({ generationId }) => {
      const existing = await db.locations.get([generationId, id]);
      if (!existing) {
        return; // Idempotent
      }

      if (
        expectedRevision !== undefined &&
        existing.revision !== expectedRevision
      ) {
        throw new ConflictError(
          `장소 영구 삭제 충돌: 현재 revision(${existing.revision})이 기대값(${expectedRevision})과 다릅니다.`,
          existing.revision,
          expectedRevision
        );
      }

      // Check if any planting (ACTIVE or TRASHED) references this location
      const linkedPlanting = await db.plantings
        .where("generationId")
        .equals(generationId)
        .filter((p) => p.locationId === id && p.recordStatus !== "PURGED")
        .first();

      if (linkedPlanting) {
        throw new ValidationError(
          `해당 장소('${existing.label}')를 참조하는 식물('${linkedPlanting.displayName}')이 존재하여 영구 삭제할 수 없습니다. 연결된 식물을 삭제하거나 다른 장소로 이동해야 합니다.`
        );
      }

      await db.locations.delete([generationId, id]);
    }
  );
}

//+_+// Location repository with generation-scoped keys and validation
import type { SikmulwangDB } from "./database";
import type {
  EnvironmentType,
  LocationRecord,
  RainfallExposure,
  SunExposure,
} from "./types";
import { withWriteTransaction } from "./transaction";
import { NotFoundError, ValidationError } from "./errors";

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
}

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
        timeZone: params.timeZone ?? "Asia/Seoul",
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

      if (updates.label !== undefined && !updates.label.trim()) {
        throw new ValidationError("장소 이름을 비워둘 수 없습니다.");
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
  id: string
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
  id: string
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
  id: string
): Promise<void> {
  await withWriteTransaction(
    db,
    [db.locations],
    sessionEpoch,
    sessionGenerationId,
    async ({ generationId }) => {
      await db.locations.delete([generationId, id]);
    }
  );
}

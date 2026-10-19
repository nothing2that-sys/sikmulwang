//+_+// Cycle repository enforcing single-active-cycle invariant per planting
import type { SikmulwangDB } from "./database";
import type { CycleRecord } from "./types";
import { withWriteTransaction } from "./transaction";
import { NotFoundError, ValidationError } from "./errors";

export interface StartCycleParams {
  plantingId: string;
  startLocalDate: string;
  timeZone?: string;
}

export interface EndCycleParams {
  cycleId: string;
  endLocalDate: string;
}

export async function listCyclesByPlanting(
  db: SikmulwangDB,
  generationId: string,
  plantingId: string,
  options: { includeTrashed?: boolean } = {}
): Promise<CycleRecord[]> {
  const allCycles = await db.cycles
    .where("generationId")
    .equals(generationId)
    .filter((c) => c.plantingId === plantingId)
    .toArray();

  if (options.includeTrashed) {
    return allCycles.filter((c) => c.recordStatus !== "PURGED");
  }

  return allCycles.filter((c) => c.recordStatus === "ACTIVE");
}

export async function getActiveCycle(
  db: SikmulwangDB,
  generationId: string,
  plantingId: string
): Promise<CycleRecord | undefined> {
  const activeCycles = await db.cycles
    .where("generationId")
    .equals(generationId)
    .filter(
      (c) =>
        c.plantingId === plantingId &&
        c.status === "ACTIVE" &&
        c.recordStatus === "ACTIVE"
    )
    .toArray();

  return activeCycles[0];
}

export async function startCycle(
  db: SikmulwangDB,
  sessionEpoch: number,
  sessionGenerationId: string,
  params: StartCycleParams
): Promise<CycleRecord> {
  if (!params.startLocalDate) {
    throw new ValidationError("시즌 시작 날짜를 입력해 주세요.");
  }

  const id = `cyc_${crypto.randomUUID()}`;

  return await withWriteTransaction(
    db,
    [db.cycles, db.plantings],
    sessionEpoch,
    sessionGenerationId,
    async ({ generationId, nowUtc }) => {
      //+_+// 1. Verify planting exists
      const planting = await db.plantings.get([generationId, params.plantingId]);
      if (!planting || planting.recordStatus === "PURGED") {
        throw new NotFoundError(`식물을 찾을 수 없습니다: ${params.plantingId}`);
      }

      //+_+// 2. Check single active cycle invariant
      const existingActive = await db.cycles
        .where("generationId")
        .equals(generationId)
        .filter(
          (c) =>
            c.plantingId === params.plantingId &&
            c.status === "ACTIVE" &&
            c.recordStatus === "ACTIVE"
        )
        .first();

      if (existingActive) {
        throw new ValidationError(
          "이미 진행 중인 시즌이 있습니다. 이전 시즌을 종료한 뒤 새로 시작해 주세요."
        );
      }

      const cycle: CycleRecord = {
        generationId,
        id,
        plantingId: params.plantingId,
        startLocalDate: params.startLocalDate,
        endLocalDate: null,
        timeZone: params.timeZone ?? "Asia/Seoul",
        status: "ACTIVE",
        recordStatus: "ACTIVE",
        createdAt: nowUtc,
        updatedAt: nowUtc,
        revision: 1,
        schemaVersion: 1,
      };

      await db.cycles.put(cycle);
      return cycle;
    }
  );
}

export async function endCycle(
  db: SikmulwangDB,
  sessionEpoch: number,
  sessionGenerationId: string,
  params: EndCycleParams
): Promise<CycleRecord> {
  if (!params.endLocalDate) {
    throw new ValidationError("시즌 종료 날짜를 입력해 주세요.");
  }

  return await withWriteTransaction(
    db,
    [db.cycles],
    sessionEpoch,
    sessionGenerationId,
    async ({ generationId, nowUtc }) => {
      const existing = await db.cycles.get([generationId, params.cycleId]);
      if (!existing || existing.recordStatus === "PURGED") {
        throw new NotFoundError(`시즌을 찾을 수 없습니다: ${params.cycleId}`);
      }
      if (existing.status === "ENDED") {
        throw new ValidationError("이미 종료된 시즌입니다.");
      }

      const updated: CycleRecord = {
        ...existing,
        status: "ENDED",
        endLocalDate: params.endLocalDate,
        updatedAt: nowUtc,
        revision: existing.revision + 1,
      };

      await db.cycles.put(updated);
      return updated;
    }
  );
}

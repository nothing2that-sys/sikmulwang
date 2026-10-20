//+_+// Transaction execution with write fence and epoch validation
import type { Table } from "dexie";
import type { SikmulwangDB } from "./database";
import {
  CorruptedMetadataError,
  StaleSessionError,
  WriteFenceActiveError,
} from "./errors";

export interface TransactionContext {
  generationId: string;
  epoch: number;
  nowUtc: string;
}

export async function withWriteTransaction<T>(
  db: SikmulwangDB,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  targetStores: Table<any, any>[],
  sessionEpoch: number,
  sessionGenerationId: string,
  fn: (ctx: TransactionContext) => Promise<T>
): Promise<T> {
  const storesToLock = [db.meta, ...targetStores];

  try {
    return await db.transaction("rw", storesToLock, async () => {
      const metaEntries = await db.meta.toArray();
      const metaMap = new Map(metaEntries.map((e) => [e.key, e.value]));

      //+_+// Strict validation of mandatory safety metadata before writing
      if (
        !metaMap.has("writeFence") ||
        typeof metaMap.get("writeFence") !== "boolean" ||
        !metaMap.has("epoch") ||
        typeof metaMap.get("epoch") !== "number" ||
        !Number.isInteger(metaMap.get("epoch")) ||
        (metaMap.get("epoch") as number) < 1 ||
        !metaMap.has("activeGenerationId") ||
        typeof metaMap.get("activeGenerationId") !== "string" ||
        !(metaMap.get("activeGenerationId") as string).trim() ||
        !metaMap.has("schemaVersion") ||
        metaMap.get("schemaVersion") !== 1
      ) {
        throw new CorruptedMetadataError(
          "필수 안전 메타데이터가 손상되었거나 누락되어 쓰기 작업이 차단되었습니다."
        );
      }

      const writeFence = metaMap.get("writeFence") as boolean;
      if (writeFence) {
        throw new WriteFenceActiveError();
      }

      const currentEpoch = metaMap.get("epoch") as number;
      const currentGenerationId = metaMap.get("activeGenerationId") as string;

      if (
        currentEpoch !== sessionEpoch ||
        currentGenerationId !== sessionGenerationId
      ) {
        throw new StaleSessionError(
          `세션 불일치: 기대한 epoch=${sessionEpoch}, 실제 epoch=${currentEpoch}`
        );
      }

      const ctx: TransactionContext = {
        generationId: currentGenerationId,
        epoch: currentEpoch,
        nowUtc: new Date().toISOString(),
      };

      return await fn(ctx);
    });
  } catch (err: unknown) {
    //+_+// If Dexie wrapped a domain error in a transaction abort wrapper, unwrap to original domain error
    if (err && typeof err === "object" && "inner" in err && err.inner instanceof Error) {
      throw err.inner;
    }
    throw err;
  }
}

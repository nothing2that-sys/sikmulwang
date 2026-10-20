//+_+// Transaction execution with unified metadata verification, write fence, and epoch validation
import type { Table } from "dexie";
import { verifyAndGetSystemMeta, type SikmulwangDB } from "./database";
import {
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
  //+_+// Ensure meta, profiles, and generationRegistry are always locked together with target stores without duplicates
  const storesToLock = Array.from(
    new Set([db.meta, db.profiles, db.generationRegistry, ...targetStores])
  );

  try {
    return await db.transaction("rw", storesToLock, async () => {
      const metaEntries = await db.meta.toArray();
      const metaMap = new Map(metaEntries.map((e) => [e.key, e.value]));

      //+_+// Strict unified metadata and pointer verification inside the same write transaction
      const systemMeta = await verifyAndGetSystemMeta(metaMap, db);

      //+_+// Check write fence state
      if (systemMeta.writeFence) {
        throw new WriteFenceActiveError();
      }

      //+_+// Check session epoch and generation match
      if (
        systemMeta.epoch !== sessionEpoch ||
        systemMeta.activeGenerationId !== sessionGenerationId
      ) {
        throw new StaleSessionError(
          `세션 불일치: 기대한 epoch=${sessionEpoch}, 실제 epoch=${systemMeta.epoch}`
        );
      }

      const ctx: TransactionContext = {
        generationId: systemMeta.activeGenerationId,
        epoch: systemMeta.epoch,
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

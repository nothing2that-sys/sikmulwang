//+_+// Transaction execution with write fence and epoch validation
import type { Table } from "dexie";
import type { SikmulwangDB } from "./database";
import { StaleSessionError, WriteFenceActiveError } from "./errors";

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

  return await db.transaction("rw", storesToLock, async () => {
    const metaEntries = await db.meta.toArray();
    const metaMap = new Map(metaEntries.map((e) => [e.key, e.value]));

    const writeFence = Boolean(metaMap.get("writeFence") ?? false);
    if (writeFence) {
      throw new WriteFenceActiveError();
    }

    const currentEpoch = Number(metaMap.get("epoch") ?? 1);
    const currentGenerationId = String(
      metaMap.get("activeGenerationId") ?? ""
    );

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
}

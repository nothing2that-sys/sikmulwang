//+_+// Profile and Generation repository with meta controls
import { verifyAndGetSystemMeta, type SikmulwangDB } from "./database";
import type {
  GenerationRecord,
  GenerationState,
  ProfileRecord,
} from "./types";
import { NotFoundError } from "./errors";

export interface SystemMetaState {
  activeProfileId: string;
  activeGenerationId: string;
  epoch: number;
  writeFence: boolean;
  schemaVersion: number;
}

export async function getSystemMeta(db: SikmulwangDB): Promise<SystemMetaState> {
  const entries = await db.meta.toArray();
  const map = new Map(entries.map((e) => [e.key, e.value]));
  return await verifyAndGetSystemMeta(map, db);
}

export async function getActiveProfile(
  db: SikmulwangDB
): Promise<ProfileRecord | undefined> {
  const meta = await getSystemMeta(db);
  return await db.profiles.get(meta.activeProfileId);
}

export async function listProfiles(db: SikmulwangDB): Promise<ProfileRecord[]> {
  return await db.profiles.toArray();
}

export async function listGenerations(
  db: SikmulwangDB,
  profileId?: string
): Promise<GenerationRecord[]> {
  if (profileId) {
    return await db.generationRegistry
      .where("profileId")
      .equals(profileId)
      .toArray();
  }
  return await db.generationRegistry.toArray();
}

export async function setWriteFence(
  db: SikmulwangDB,
  active: boolean
): Promise<void> {
  const now = new Date().toISOString();
  await db.meta.put({
    key: "writeFence",
    value: active,
    updatedAt: now,
  });
}

export async function bumpEpoch(db: SikmulwangDB): Promise<number> {
  const meta = await getSystemMeta(db);
  const nextEpoch = meta.epoch + 1;
  const now = new Date().toISOString();
  await db.meta.put({
    key: "epoch",
    value: nextEpoch,
    updatedAt: now,
  });
  return nextEpoch;
}

export async function switchActiveGeneration(
  db: SikmulwangDB,
  targetGenerationId: string
): Promise<void> {
  await db.transaction(
    "rw",
    [db.meta, db.generationRegistry, db.profiles],
    async () => {
      const gen = await db.generationRegistry.get(targetGenerationId);
      if (!gen) {
        throw new NotFoundError(
          `존재하지 않는 세대입니다: ${targetGenerationId}`
        );
      }

      const meta = await getSystemMeta(db);
      const nextEpoch = meta.epoch + 1;
      const now = new Date().toISOString();

      await db.meta.put({
        key: "activeGenerationId",
        value: targetGenerationId,
        updatedAt: now,
      });
      await db.meta.put({
        key: "epoch",
        value: nextEpoch,
        updatedAt: now,
      });

      const profile = await db.profiles.get(gen.profileId);
      if (profile) {
        await db.profiles.put({
          ...profile,
          currentGenerationId: targetGenerationId,
          updatedAt: now,
        });
      }
    }
  );
}

export async function registerGeneration(
  db: SikmulwangDB,
  generationId: string,
  profileId: string,
  state: GenerationState
): Promise<GenerationRecord> {
  const now = new Date().toISOString();
  const record: GenerationRecord = {
    generationId,
    profileId,
    state,
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
  };
  await db.generationRegistry.put(record);
  return record;
}

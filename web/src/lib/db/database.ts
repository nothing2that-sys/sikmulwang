//+_+// Dexie database definition conforming to docs/12_DATA_CONTRACT_V1.md
import Dexie, { type Table } from "dexie";
import { CorruptedMetadataError, WriteFenceActiveError } from "./errors";
import { preserveLegacyRuleSnapshotReferences } from "./writerCompatibility";
import type {
  MetaEntry,
  ProfileRecord,
  GenerationRecord,
  LocationRecord,
  EnvironmentHistoryRecord,
  PlantingRecord,
  CycleRecord,
  UserPreferenceRecord,
  TaxonSnapshotRecord,
  CareEventRecord,
  ObservationRecord,
  TaskOccurrenceRecord,
  TaskChangeRecord,
  CareRuleRecord,
  RuleSnapshotRecord,
  DecisionLogRecord,
  DiaryRecord,
  MediaRecord,
  MediaBlobRecord,
  MediaLinkRecord,
  HarvestRecord,
  RiskNoticeRecord,
  FeedbackOverrideRecord,
} from "./types";

export class SikmulwangDB extends Dexie {
  meta!: Table<MetaEntry, string>;
  profiles!: Table<ProfileRecord, string>;
  generationRegistry!: Table<GenerationRecord, string>;
  locations!: Table<LocationRecord, [string, string]>;
  environmentHistory!: Table<EnvironmentHistoryRecord, [string, string]>;
  plantings!: Table<PlantingRecord, [string, string]>;
  cycles!: Table<CycleRecord, [string, string]>;
  userPreferences!: Table<UserPreferenceRecord, [string, string]>;

  //+_+// Future phase placeholder tables
  taxonSnapshots!: Table<TaxonSnapshotRecord, [string, string]>;
  careEvents!: Table<CareEventRecord, [string, string]>;
  observations!: Table<ObservationRecord, [string, string]>;
  taskOccurrences!: Table<TaskOccurrenceRecord, [string, string]>;
  taskChanges!: Table<TaskChangeRecord, [string, string]>;
  careRules!: Table<CareRuleRecord, [string, string]>;
  ruleSnapshots!: Table<RuleSnapshotRecord, [string, string]>;
  decisionLogs!: Table<DecisionLogRecord, [string, string]>;
  diaries!: Table<DiaryRecord, [string, string]>;
  media!: Table<MediaRecord, [string, string]>;
  mediaBlobs!: Table<MediaBlobRecord, [string, string]>;
  mediaLinks!: Table<MediaLinkRecord, [string, string]>;
  harvests!: Table<HarvestRecord, [string, string]>;
  riskNotices!: Table<RiskNoticeRecord, [string, string]>;
  feedbackOverrides!: Table<FeedbackOverrideRecord, [string, string]>;

  constructor(dbName = "sikmulwang-db") {
    super(dbName);
    this.version(1).stores({
      meta: "key",
      profiles: "profileId",
      generationRegistry: "generationId, profileId, state",
      locations: "[generationId+id], generationId, recordStatus",
      environmentHistory:
        "[generationId+id], generationId, plantingId, locationId, validFrom, validTo, recordStatus",
      plantings:
        "[generationId+id], generationId, locationId, growingStatus, recordStatus",
      cycles:
        "[generationId+id], generationId, plantingId, status, recordStatus",
      userPreferences: "[generationId+id], generationId",

      //+_+// Placeholder tables for schema completeness
      taxonSnapshots: "[generationId+id], generationId",
      careEvents: "[generationId+id], generationId, cycleId, idempotencyKey",
      observations:
        "[generationId+id], generationId, cycleId, idempotencyKey",
      taskOccurrences: "[generationId+id], generationId, cycleId, status",
      taskChanges: "[generationId+id], generationId, taskId",
      careRules: "[generationId+id], generationId",
      ruleSnapshots: "[generationId+id], generationId",
      decisionLogs: "[generationId+id], generationId, targetId",
      diaries: "[generationId+id], generationId, cycleId, entryLocalDate",
      media: "[generationId+id], generationId, sha256",
      mediaBlobs: "[generationId+id], generationId, mediaId",
      mediaLinks: "[generationId+id], generationId, ownerId, mediaId",
      harvests: "[generationId+id], generationId, cycleId, careEventId",
      riskNotices: "[generationId+id], generationId, cycleId, dedupeKey",
      feedbackOverrides: "[generationId+id], generationId, targetId",
    });
  }
}

let defaultDbInstance: SikmulwangDB | null = null;

export function getDb(): SikmulwangDB {
  if (!defaultDbInstance) {
    defaultDbInstance = new SikmulwangDB();
  }
  return defaultDbInstance;
}

export function setDbInstance(db: SikmulwangDB | null): void {
  defaultDbInstance = db;
}

//+_+// Global writer compatibility v2 is distinct from physical Dexie v1 and domain record schema v1.
export const WRITER_COMPATIBILITY_VERSION = 2;
export const SUPPORTED_SCHEMA_VERSION = WRITER_COMPATIBILITY_VERSION;
export const RECORD_SCHEMA_VERSION = 1;

export interface InitializedMeta {
  activeProfileId: string;
  activeGenerationId: string;
  epoch: number;
  writeFence: boolean;
  schemaVersion: number;
}

//+_+// Verifies safety metadata consistency and pointer reference integrity
export async function verifyAndGetSystemMeta(
  metaMap: Map<string, unknown>,
  db: SikmulwangDB
): Promise<InitializedMeta> {
  return validateSystemMeta(metaMap, db, SUPPORTED_SCHEMA_VERSION);
}

//+_+// Only initialization may validate legacy writer metadata for the atomic transition.
async function validateSystemMeta(
  metaMap: Map<string, unknown>,
  db: SikmulwangDB,
  expectedVersion: number
): Promise<InitializedMeta> {
  const missingKeys = [
    "activeProfileId",
    "activeGenerationId",
    "epoch",
    "writeFence",
    "schemaVersion",
  ].filter((k) => !metaMap.has(k));

  if (missingKeys.length > 0) {
    throw new CorruptedMetadataError(
      `데이터베이스 안전 메타데이터가 손상되었습니다. 누락된 키: ${missingKeys.join(", ")}`
    );
  }

  const activeProfileId = metaMap.get("activeProfileId");
  const activeGenerationId = metaMap.get("activeGenerationId");
  const epoch = metaMap.get("epoch");
  const writeFence = metaMap.get("writeFence");
  const schemaVersion = metaMap.get("schemaVersion");

  if (typeof activeProfileId !== "string" || !activeProfileId.trim()) {
    throw new CorruptedMetadataError("유효하지 않은 activeProfileId 메타데이터입니다.");
  }
  if (typeof activeGenerationId !== "string" || !activeGenerationId.trim()) {
    throw new CorruptedMetadataError("유효하지 않은 activeGenerationId 메타데이터입니다.");
  }
  if (
    typeof epoch !== "number" ||
    !Number.isFinite(epoch) ||
    !Number.isSafeInteger(epoch) ||
    epoch < 1
  ) {
    throw new CorruptedMetadataError(
      `유효하지 않은 epoch 메타데이터입니다: ${String(epoch)}`
    );
  }
  if (typeof writeFence !== "boolean") {
    throw new CorruptedMetadataError(
      `writeFence는 반드시 boolean이어야 합니다. 입력값: ${String(writeFence)}`
    );
  }
  if (schemaVersion !== expectedVersion) {
    throw new CorruptedMetadataError(
      `지원하지 않는 스키마 버전입니다: ${String(schemaVersion)} (지원 버전: ${expectedVersion})`
    );
  }

  //+_+// Cross-reference active pointers with registered entities
  const profile = await db.profiles.get(activeProfileId);
  if (!profile) {
    throw new CorruptedMetadataError(
      `활성 프로필 레코드가 존재하지 않습니다: ${activeProfileId}`
    );
  }

  const generation = await db.generationRegistry.get(activeGenerationId);
  if (!generation) {
    throw new CorruptedMetadataError(
      `활성 세대 레코드가 존재하지 않습니다: ${activeGenerationId}`
    );
  }

  if (generation.profileId !== activeProfileId) {
    throw new CorruptedMetadataError(
      `활성 세대의 profileId(${generation.profileId})가 activeProfileId(${activeProfileId})와 일치하지 않습니다.`
    );
  }

  if (generation.state !== "ACTIVE") {
    throw new CorruptedMetadataError(
      `활성 세대의 상태가 ACTIVE가 아닙니다. 현재 상태: ${generation.state}`
    );
  }

  return {
    activeProfileId,
    activeGenerationId,
    epoch,
    writeFence,
    schemaVersion: schemaVersion as number,
  };
}

export async function initializeDatabase(
  db: SikmulwangDB = getDb()
): Promise<InitializedMeta> {
  return await db.transaction(
    "rw",
    db.tables,
    async () => {
      const metaEntries = await db.meta.toArray();
      const metaMap = new Map(metaEntries.map((e) => [e.key, e.value]));

      // 1. Existing database: MUST verify integrity of safety metadata
      if (metaEntries.length > 0) {
        if (metaMap.get("schemaVersion") === 1) {
          const legacy = await validateSystemMeta(metaMap, db, 1);
          if (legacy.writeFence) throw new WriteFenceActiveError();
          if (!Number.isSafeInteger(legacy.epoch + 1)) {
            throw new CorruptedMetadataError("호환성 전환에 필요한 epoch를 갱신할 수 없습니다.");
          }
          const now = new Date().toISOString();
          //+_+// Original domain rows/logs are immutable; verified snapshot aliases are append-only.
          await preserveLegacyRuleSnapshotReferences(db, now);
          await db.meta.put({ key: "epoch", value: legacy.epoch + 1, updatedAt: now });
          await db.meta.put({ key: "schemaVersion", value: SUPPORTED_SCHEMA_VERSION, updatedAt: now });
          await db.meta.put({
            key: "writerCompatibility",
            value: { from: 1, to: SUPPORTED_SCHEMA_VERSION, recordSchemaVersion: RECORD_SCHEMA_VERSION },
            updatedAt: now,
          });
          return { ...legacy, epoch: legacy.epoch + 1, schemaVersion: SUPPORTED_SCHEMA_VERSION };
        }
        return await verifyAndGetSystemMeta(metaMap, db);
      }

      // 2. Clean initial run: meta store is completely empty
      for (const table of db.tables) {
        if (table.name !== "meta" && await table.count()) {
          throw new CorruptedMetadataError("안전 메타데이터 없는 기존 기록은 초기화할 수 없습니다.");
        }
      }
      const defaultProfileId = "p_default";
      const defaultGenerationId = "g_default";
      const defaultEpoch = 1;
      const defaultSchemaVersion = RECORD_SCHEMA_VERSION;
      const now = new Date().toISOString();

      // 1. Create default profile if not exists
      const existingProfile = await db.profiles.get(defaultProfileId);
      if (!existingProfile) {
        await db.profiles.put({
          profileId: defaultProfileId,
          name: "기본 정원",
          currentGenerationId: defaultGenerationId,
          createdAt: now,
          updatedAt: now,
        });
      }

      // 2. Create default generation if not exists
      const existingGen = await db.generationRegistry.get(defaultGenerationId);
      if (!existingGen) {
        await db.generationRegistry.put({
          generationId: defaultGenerationId,
          profileId: defaultProfileId,
          state: "ACTIVE",
          schemaVersion: defaultSchemaVersion,
          createdAt: now,
          updatedAt: now,
        });
      }

      // 3. Seed locations only if no location exists in this generation
      const existingLocCount = await db.locations
        .where("generationId")
        .equals(defaultGenerationId)
        .count();

      if (existingLocCount === 0) {
        const seedLocations: LocationRecord[] = [
          {
            generationId: defaultGenerationId,
            id: "loc_indoor_living",
            label: "거실 창가 (실내)",
            environmentType: "INDOOR",
            rainfallExposure: "COVERED",
            sunExposure: "PARTIAL_SUN",
            timeZone: "Asia/Seoul",
            recordStatus: "ACTIVE",
            createdAt: now,
            updatedAt: now,
            revision: 1,
            schemaVersion: defaultSchemaVersion,
          },
          {
            generationId: defaultGenerationId,
            id: "loc_balcony",
            label: "베란다 정원 (베란다)",
            environmentType: "BALCONY",
            rainfallExposure: "COVERED",
            sunExposure: "FULL_SUN",
            timeZone: "Asia/Seoul",
            recordStatus: "ACTIVE",
            createdAt: now,
            updatedAt: now,
            revision: 1,
            schemaVersion: defaultSchemaVersion,
          },
          {
            generationId: defaultGenerationId,
            id: "loc_outdoor_yard",
            label: "마당 화단 (야외)",
            environmentType: "OUTDOOR",
            rainfallExposure: "EXPOSED",
            sunExposure: "FULL_SUN",
            timeZone: "Asia/Seoul",
            recordStatus: "ACTIVE",
            createdAt: now,
            updatedAt: now,
            revision: 1,
            schemaVersion: defaultSchemaVersion,
          },
        ];

        for (const loc of seedLocations) {
          await db.locations.put(loc);
        }
      }

      // 4. Create default user preferences if not exists
      const existingPref = await db.userPreferences.get([
        defaultGenerationId,
        "pref_default",
      ]);
      if (!existingPref) {
        await db.userPreferences.put({
          generationId: defaultGenerationId,
          id: "pref_default",
          timeZone: "Asia/Seoul",
          locationSetting: "loc_indoor_living",
          defaultInspectionDays: 7,
          notificationPreferences: { careReminders: true },
          recordStatus: "ACTIVE",
          createdAt: now,
          updatedAt: now,
          revision: 1,
          schemaVersion: defaultSchemaVersion,
        });
      }

      // 5. Populate meta store
      await db.meta.bulkPut([
        { key: "activeProfileId", value: defaultProfileId, updatedAt: now },
        {
          key: "activeGenerationId",
          value: defaultGenerationId,
          updatedAt: now,
        },
        { key: "epoch", value: defaultEpoch, updatedAt: now },
        { key: "writeFence", value: false, updatedAt: now },
        { key: "schemaVersion", value: SUPPORTED_SCHEMA_VERSION, updatedAt: now },
      ]);

      return {
        activeProfileId: defaultProfileId,
        activeGenerationId: defaultGenerationId,
        epoch: defaultEpoch,
        writeFence: false,
        schemaVersion: SUPPORTED_SCHEMA_VERSION,
      };
    }
  );
}

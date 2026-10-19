//+_+// Dexie database definition conforming to docs/12_DATA_CONTRACT_V1.md
import Dexie, { type Table } from "dexie";
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

export interface InitializedMeta {
  activeProfileId: string;
  activeGenerationId: string;
  epoch: number;
  writeFence: boolean;
  schemaVersion: number;
}

export async function initializeDatabase(
  db: SikmulwangDB = getDb()
): Promise<InitializedMeta> {
  const metaEntries = await db.meta.toArray();
  const metaMap = new Map(metaEntries.map((e) => [e.key, e.value]));

  const hasInitialized =
    metaMap.has("activeProfileId") &&
    metaMap.has("activeGenerationId") &&
    metaMap.has("epoch");

  const now = new Date().toISOString();

  if (!hasInitialized) {
    const defaultProfileId = "p_default";
    const defaultGenerationId = "g_default";
    const defaultEpoch = 1;
    const defaultSchemaVersion = 1;

    await db.transaction(
      "rw",
      [
        db.meta,
        db.profiles,
        db.generationRegistry,
        db.locations,
        db.userPreferences,
      ],
      async () => {
        //+_+// 1. Create default profile
        await db.profiles.put({
          profileId: defaultProfileId,
          name: "기본 정원",
          currentGenerationId: defaultGenerationId,
          createdAt: now,
          updatedAt: now,
        });

        //+_+// 2. Create default generation
        await db.generationRegistry.put({
          generationId: defaultGenerationId,
          profileId: defaultProfileId,
          state: "ACTIVE",
          schemaVersion: defaultSchemaVersion,
          createdAt: now,
          updatedAt: now,
        });

        //+_+// 3. Create default seed locations
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

        //+_+// 4. Create default user preferences
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

        //+_+// 5. Populate meta store
        await db.meta.bulkPut([
          { key: "activeProfileId", value: defaultProfileId, updatedAt: now },
          {
            key: "activeGenerationId",
            value: defaultGenerationId,
            updatedAt: now,
          },
          { key: "epoch", value: defaultEpoch, updatedAt: now },
          { key: "writeFence", value: false, updatedAt: now },
          { key: "schemaVersion", value: defaultSchemaVersion, updatedAt: now },
        ]);
      }
    );

    return {
      activeProfileId: defaultProfileId,
      activeGenerationId: defaultGenerationId,
      epoch: defaultEpoch,
      writeFence: false,
      schemaVersion: defaultSchemaVersion,
    };
  }

  return {
    activeProfileId: String(metaMap.get("activeProfileId") ?? "p_default"),
    activeGenerationId: String(
      metaMap.get("activeGenerationId") ?? "g_default"
    ),
    epoch: Number(metaMap.get("epoch") ?? 1),
    writeFence: Boolean(metaMap.get("writeFence") ?? false),
    schemaVersion: Number(metaMap.get("schemaVersion") ?? 1),
  };
}

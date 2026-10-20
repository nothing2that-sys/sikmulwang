//+_+// P1 local data foundation types complying with docs/12_DATA_CONTRACT_V1.md

export type GenerationState = "ACTIVE" | "STAGING" | "ARCHIVED" | "ABORTED";
export type RecordStatus = "ACTIVE" | "TRASHED" | "PURGED";
export type GrowingStatus = "GROWING" | "HARVESTED" | "DORMANT" | "DEAD";
export type GroupType = "INDIVIDUAL" | "GROUP";
export type EnvironmentType = "INDOOR" | "BALCONY" | "OUTDOOR" | "GREENHOUSE";
export type RainfallExposure = "COVERED" | "EXPOSED" | "SHELTERED";
export type SunExposure = "FULL_SUN" | "PARTIAL_SUN" | "SHADE" | "ARTIFICIAL";
export type CycleStatus = "ACTIVE" | "ENDED";

export interface MetaEntry {
  key: string;
  value: unknown;
  updatedAt: string;
}

export interface ProfileRecord {
  profileId: string;
  name: string;
  currentGenerationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface GenerationRecord {
  generationId: string;
  profileId: string;
  state: GenerationState;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface LocationRecord {
  generationId: string;
  id: string;
  label: string;
  environmentType: EnvironmentType;
  rainfallExposure: RainfallExposure;
  sunExposure: SunExposure;
  timeZone: string;
  recordStatus: RecordStatus;
  createdAt: string;
  updatedAt: string;
  revision: number;
  schemaVersion: number;
}

export interface EnvironmentSnapshot {
  label: string;
  environmentType: EnvironmentType;
  rainfallExposure: RainfallExposure;
  sunExposure: SunExposure;
  timeZone: string;
}

export interface EnvironmentHistoryRecord {
  generationId: string;
  id: string;
  plantingId: string;
  locationId: string;
  validFrom: string;
  validTo: string | null;
  environmentSnapshot: EnvironmentSnapshot;
  recordStatus: RecordStatus;
  createdAt: string;
  updatedAt: string;
  revision: number;
  schemaVersion: number;
}

export interface PlantingRecord {
  generationId: string;
  id: string;
  taxonSnapshotId: string | null;
  displayName: string;
  groupType: GroupType;
  quantity: number;
  unit: string;
  locationId: string;
  growingStatus: GrowingStatus;
  recordStatus: RecordStatus;
  splitFromPlantingId: string | null;
  quantityChangeReason: string | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
  schemaVersion: number;
}

export interface CycleRecord {
  generationId: string;
  id: string;
  plantingId: string;
  startLocalDate: string;
  endLocalDate: string | null;
  timeZone: string;
  status: CycleStatus;
  recordStatus: RecordStatus;
  createdAt: string;
  updatedAt: string;
  revision: number;
  schemaVersion: number;
}

export interface UserPreferenceRecord {
  generationId: string;
  id: string;
  timeZone: string;
  locationSetting: string | null;
  defaultInspectionDays: number;
  notificationPreferences: Record<string, boolean>;
  recordStatus: RecordStatus;
  createdAt: string;
  updatedAt: string;
  revision: number;
  schemaVersion: number;
}

//+_+// Placeholders for future phases (P2~P4) to preserve schema integrity
export interface TaxonSnapshotRecord {
  generationId: string;
  id: string;
  canonicalName: string;
  taxonRank: string;
  sourceKind: string;
  sourceVersion: string;
  sourceUrl: string | null;
}

export interface CareRecordMeta {
  createdAt: string; updatedAt: string; revision: number; schemaVersion: number;
}

export interface CareEventRecord extends CareRecordMeta {
  generationId: string;
  id: string;
  cycleId: string;
  actionKind: string;
  occurredAt: string;
  idempotencyKey: string;
  correctionOfId: string | null;
  eventStatus: string;
}

export interface ObservationRecord extends CareRecordMeta {
  generationId: string;
  id: string;
  cycleId: string;
  correctionOfId: string | null;
  eventStatus: string;
  observationKind: string;
  value: string;
  occurredAt: string;
  idempotencyKey: string;
}

export interface TaskOccurrenceRecord extends CareRecordMeta {
  priority: number;
  generationId: string;
  id: string;
  cycleId: string;
  actionKind: string;
  occurrenceSeq: number;
  anchorId: string;
  dueLocalDate: string;
  status: string;
  resolutionType: string | null;
  resolutionId: string | null;
}

export interface TaskChangeRecord extends CareRecordMeta {
  generationId: string;
  id: string;
  taskId: string;
  previousState: string;
  nextState: string;
  idempotencyKey: string;
  requestBody: string;
  sourceId: string;
  occurredAt: string;
}

export interface CareRuleRecord extends CareRecordMeta {
  generationId: string;
  id: string;
  version: string;
  actionKind: string;
  inspectionDays: number | null;
  cycleId: string;
  applicability: string;
  provenance: string;
}

export interface RuleSnapshotRecord extends CareRecordMeta {
  aliasOfId?: string;
  generationId: string;
  id: string;
  stableRuleId: string;
  version: string;
  normalizedBody: string;
  sha256: string;
}

export interface DecisionLogRecord extends CareRecordMeta {
  idempotencyKey: string;
  requestBody: string;
  resultTaskId: string | null;
  generationId: string;
  id: string;
  targetType: string;
  targetId: string;
  algorithmVersion: string;
  inputSnapshot: string;
  ruleSnapshotIds: string[];
  outputSnapshot: string;
  inputDigest: string;
  ruleSnapshotHash: string;
  evaluatedAt: string;
}

export interface DiaryRecord {
  generationId: string;
  id: string;
  cycleId: string;
  entryLocalDate: string;
  timeZone: string;
  title: string | null;
  body: string;
  draftState: string;
  revision: number;
}

export interface MediaRecord {
  generationId: string;
  id: string;
  mimeType: string;
  byteLength: number;
  sha256: string;
  capturedAt: string | null;
  capturedLocalDate: string | null;
  privacyState: string;
  variants: string[];
}

export interface MediaBlobRecord {
  generationId: string;
  id: string;
  mediaId: string;
  variant: string;
  blob: Blob;
  sha256: string;
  byteLength: number;
}

export interface MediaLinkRecord {
  generationId: string;
  id: string;
  ownerType: string;
  ownerId: string;
  mediaId: string;
  sortOrder: number;
}

export interface HarvestRecord {
  generationId: string;
  id: string;
  cycleId: string;
  careEventId: string;
  quantity: number;
  unit: string;
  occurredAt: string;
  status: string;
}

export interface RiskNoticeRecord {
  generationId: string;
  id: string;
  cycleId: string;
  riskKind: string;
  dedupeKey: string;
  state: string;
  validFrom: string;
  expiresAt: string;
  sourceSnapshot: string;
}

export interface FeedbackOverrideRecord {
  generationId: string;
  id: string;
  scope: string;
  targetId: string;
  overrideKind: string;
  value: string;
  reason: string;
  updatedAt: string;
}

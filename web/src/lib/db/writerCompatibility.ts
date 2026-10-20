import Dexie from "dexie";
import type { SikmulwangDB } from "./database";
import type { RuleSnapshotRecord } from "./types";
import { CorruptedMetadataError } from "./errors";
import { canonical, sha256 } from "../care/engine";

export async function verifyRuleSnapshot(snapshot: RuleSnapshotRecord, expectedBody?: string): Promise<void> {
  if (typeof snapshot.normalizedBody !== "string" || typeof snapshot.sha256 !== "string") {
    throw new CorruptedMetadataError("규칙 스냅샷의 본문과 해시가 필요합니다.");
  }
  const actualHash = await Dexie.waitFor(sha256(snapshot.normalizedBody));
  if (actualHash !== snapshot.sha256 || (expectedBody !== undefined && snapshot.normalizedBody !== expectedBody)) {
    throw new CorruptedMetadataError("규칙 스냅샷의 본문과 SHA-256이 일치하지 않습니다.");
  }
  try {
    const body: unknown = JSON.parse(snapshot.normalizedBody);
    if (!body || typeof body !== "object" || !("id" in body) || body.id !== snapshot.stableRuleId || !("version" in body) || body.version !== snapshot.version) {
      throw new Error("invalid snapshot identity");
    }
  } catch {
    throw new CorruptedMetadataError("규칙 스냅샷의 식별자 또는 버전이 손상되었습니다.");
  }
}

//+_+// Runs only within initialization's transaction locking all stores; never rewrites historical logs.
export async function preserveLegacyRuleSnapshotReferences(db: SikmulwangDB, nowUtc: string): Promise<void> {
  const snapshots = await db.ruleSnapshots.toArray();
  for (const snapshot of snapshots) {
    const rule = await db.careRules.get([snapshot.generationId, snapshot.stableRuleId]);
    const expectedBody = rule ? canonical({ id: rule.id, version: rule.version, kind: "SOIL_CHECK", inspectionDays: rule.inspectionDays, provenance: rule.provenance }) : undefined;
    await verifyRuleSnapshot(snapshot, expectedBody);
  }
  for (const snapshot of snapshots) {
    if (snapshot.id !== `rule/${snapshot.stableRuleId}`) continue;
    const id = snapshot.stableRuleId;
    const existing = await db.ruleSnapshots.get([snapshot.generationId, id]);
    if (existing) {
      await verifyRuleSnapshot(existing, snapshot.normalizedBody);
      if (existing.stableRuleId !== snapshot.stableRuleId || existing.version !== snapshot.version || existing.sha256 !== snapshot.sha256) {
        throw new CorruptedMetadataError("기존 규칙 스냅샷 참조가 충돌합니다.");
      }
      continue;
    }
    await db.ruleSnapshots.add({
      ...snapshot, id, aliasOfId: snapshot.id,
      createdAt: nowUtc, updatedAt: nowUtc, revision: 1,
    });
  }
  for (const log of await db.decisionLogs.toArray()) {
    if (log.algorithmVersion !== "rules-v1" || log.targetType !== "TASK") continue;
    let evidence: { ruleSnapshotId?: unknown; ruleSnapshotHash?: unknown };
    try { evidence = JSON.parse(log.outputSnapshot).evidence; }
    catch { throw new CorruptedMetadataError("기존 결정 로그의 snapshot 참조를 읽을 수 없습니다."); }
    if (!evidence || typeof evidence.ruleSnapshotId !== "string" || !Array.isArray(log.ruleSnapshotIds) || log.ruleSnapshotIds.length === 0) {
      throw new CorruptedMetadataError("기존 결정 로그의 snapshot 참조가 손상되었습니다.");
    }
    for (const id of [...log.ruleSnapshotIds, evidence.ruleSnapshotId]) {
      const snapshot = await db.ruleSnapshots.get([log.generationId, id]);
      if (!snapshot || snapshot.sha256 !== log.ruleSnapshotHash || snapshot.sha256 !== evidence.ruleSnapshotHash) {
        throw new CorruptedMetadataError("기존 결정 로그와 규칙 snapshot의 참조 또는 해시가 일치하지 않습니다.");
      }
    }
  }
}

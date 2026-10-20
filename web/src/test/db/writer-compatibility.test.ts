import Dexie from "dexie";
import { Blob as NodeBlob } from "node:buffer";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SikmulwangDB, initializeDatabase, verifyAndGetSystemMeta } from "../../lib/db/database";
import { executeCare } from "../../lib/care/repository";
import { canonical, sha256 } from "../../lib/care/engine";
import { SikmulwangDB as P1DB, initializeDatabase as initializeP1 } from "../fixtures/p1-8aebf378/database";
import * as p1Plants from "../fixtures/p1-8aebf378/plantingRepository";
import { getSystemMeta as getP1Meta, setWriteFence as setP1Fence } from "../fixtures/p1-8aebf378/profileRepository";
import { withWriteTransaction as withP1Write } from "../fixtures/p1-8aebf378/transaction";
import frozen from "../fixtures/p2-608da74-state.json";
import legacyHashes from "../fixtures/p1-8aebf378/SHA256.json";

describe("P2 R1 compatibility transition with actual frozen P1 writers", () => {
  let old: P1DB;
  let db: SikmulwangDB;
  const generation = "g_default";
  beforeEach(async () => {
    const name = `compat-${crypto.randomUUID()}`;
    old = new P1DB(name);
    await initializeP1(old);
    db = new SikmulwangDB(name);
  });
  afterEach(async () => { old.close(); await db.delete(); });

  const seedPlant = () => p1Plants.createPlanting(old, 1, generation, {
    displayName: "구 P1 보존 식물", locationId: "loc_indoor_living", groupType: "INDIVIDUAL", quantity: 1,
    startLocalDate: "2026-10-01",
  });
  it("frozen P1 source matches its LF-normalized SHA-256 manifest", async () => {
    for (const [file, hash] of Object.entries(legacyHashes)) {
      const source = readFileSync(resolve("src/test/fixtures/p1-8aebf378", file), "utf8").replace(/\r\n/g, "\n");
      expect(await sha256(source)).toBe(hash);
    }
  });
  async function state() {
    const stores: Record<string, unknown[]> = {};
    for (const table of db.tables) stores[table.name] = await table.toArray();
    const blobs = await db.mediaBlobs.toArray();
    stores.mediaBlobs = await Promise.all(blobs.map(async row => ({ ...row, blob: Array.from(new Uint8Array(await row.blob.arrayBuffer())) })));
    return stores;
  }
  async function loadFrozen() {
    await db.transaction("rw", db.tables, async () => {
      for (const table of db.tables) await table.clear();
      for (const [name, rows] of Object.entries(frozen.stores)) if (rows.length) await db.table(name).bulkAdd(rows);
      const blob = new NodeBlob(["기존 사용자 미디어 원본 bytes"]) as unknown as Blob;
      await db.mediaBlobs.add({ generationId: generation, id: "protected-media", mediaId: "m", variant: "ORIGINAL", blob, sha256: "opaque-preserved", byteLength: blob.size });
    });
  }

  it("kept-open P1 purge/create/update are rejected and all records survive", async () => {
    const { planting, cycle } = await seedPlant();
    const meta = await initializeDatabase(db);
    expect(meta).toMatchObject({ schemaVersion: 2, epoch: 2 });
    await executeCare(db, meta.epoch, generation, { cycleId: cycle!.id, kind: "RULE", expectedRevision: 1, inspectionDays: 5, occurredAt: "2026-10-14T00:00:00.000Z", idempotencyKey: crypto.randomUUID() });
    const task = (await db.taskOccurrences.toArray())[0];
    await executeCare(db, meta.epoch, generation, { cycleId: cycle!.id, taskId: task.id, kind: "WATERED", expectedRevision: task.revision, occurredAt: "2026-10-14T00:00:00.000Z", idempotencyKey: crypto.randomUUID() });
    const before = await state();
    expect(old.isOpen()).toBe(true);
    await expect(p1Plants.trashPlanting(old, 1, generation, planting.id, 1)).rejects.toThrow("지원하지 않는 스키마");
    await expect(p1Plants.purgePlanting(old, 1, generation, planting.id, 1)).rejects.toThrow("지원하지 않는 스키마");
    await expect(p1Plants.updatePlanting(old, 1, generation, planting.id, { displayName: "잘못된 변경", expectedRevision: 1 })).rejects.toThrow("지원하지 않는 스키마");
    await expect(seedPlant()).rejects.toThrow("지원하지 않는 스키마");
    expect(await state()).toEqual(before);
  });

  it("reopened P1 application initialization and protected writers refuse meta2", async () => {
    const { planting } = await seedPlant();
    await initializeDatabase(db);
    old.close(); old = new P1DB(db.name);
    const before = await state();
    await expect(initializeP1(old)).rejects.toThrow("지원하지 않는 스키마");
    await expect(getP1Meta(old)).rejects.toThrow("지원하지 않는 스키마");
    await expect(p1Plants.purgePlanting(old, 2, generation, planting.id, 1)).rejects.toThrow("지원하지 않는 스키마");
    expect(await state()).toEqual(before);
  });

  it("simultaneous P2 initializers advance epoch exactly once and preserve all P1 rows", async () => {
    await seedPlant(); const before = await state();
    const other = new SikmulwangDB(db.name);
    try {
      const metas = await Promise.all([initializeDatabase(db), initializeDatabase(other), initializeDatabase(db)]);
      expect(metas.every(m => m.epoch === 2 && m.schemaVersion === 2)).toBe(true);
      const after = await state();
      for (const [name, rows] of Object.entries(before)) if (name !== "meta") expect(after[name]).toEqual(rows);
      expect(await initializeDatabase(db)).toMatchObject({ epoch: 2, schemaVersion: 2 });
      expect(db.verno).toBe(1);
    } finally { other.close(); }
  });

  it("a P1 write holding the lock commits before transition and is preserved", async () => {
    const { planting } = await seedPlant();
    let entered!: () => void, release!: () => void;
    const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const write = withP1Write(old, [old.plantings], 1, generation, async () => {
      entered(); await Dexie.waitFor(gate);
      await old.plantings.put({ ...planting, displayName: "전환 전에 커밋됨", revision: 2 });
    });
    await enteredPromise;
    const transition = initializeDatabase(db); release();
    await Promise.all([write, transition]);
    expect((await db.plantings.get([generation, planting.id]))?.displayName).toBe("전환 전에 커밋됨");
  });

  it("a P1 write queued after transition's lock cannot commit", async () => {
    const { planting } = await seedPlant(); await db.open();
    let entered!: () => void, release!: () => void;
    const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const transition = db.transaction("rw", db.tables, async () => {
      const meta = await initializeDatabase(db); entered(); await Dexie.waitFor(gate); return meta;
    });
    await enteredPromise;
    const write = Dexie.ignoreTransaction(() => p1Plants.updatePlanting(old, 1, generation, planting.id, { displayName: "거부될 변경", expectedRevision: 1 }));
    const rejected = expect(write).rejects.toThrow("지원하지 않는 스키마");
    release(); await transition; await rejected;
    expect((await db.plantings.get([generation, planting.id]))?.displayName).toBe(planting.displayName);
  });

  it("R3 legacy logs/prefix snapshots remain unchanged and every historical evidence ID resolves", async () => {
    await loadFrozen(); const before = await state();
    await initializeDatabase(db); const after = await state();
    for (const [name, rows] of Object.entries(before)) {
      if (name === "meta") continue;
      if (name !== "ruleSnapshots") expect(after[name]).toEqual(rows);
    }
    for (const snapshot of frozen.stores.ruleSnapshots) {
      expect(await db.ruleSnapshots.get([snapshot.generationId, snapshot.id])).toEqual(snapshot);
      const alias = await db.ruleSnapshots.get([snapshot.generationId, snapshot.stableRuleId]);
      expect(alias).toMatchObject({ aliasOfId: snapshot.id, normalizedBody: snapshot.normalizedBody, sha256: snapshot.sha256 });
    }
    for (const log of frozen.stores.decisionLogs) {
      const output = JSON.parse(log.outputSnapshot);
      for (const id of [...log.ruleSnapshotIds, output.evidence.ruleSnapshotId]) {
        if (id) expect(await db.ruleSnapshots.get([log.generationId, id])).toBeDefined();
      }
    }
    expect(await db.ruleSnapshots.count()).toBe(frozen.stores.ruleSnapshots.length * 2);
    expect(await initializeDatabase(db)).toMatchObject({ epoch: 2, schemaVersion: 2 });
    expect(await db.ruleSnapshots.count()).toBe(frozen.stores.ruleSnapshots.length * 2);
  });

  it("failure between epoch/schema writes rolls back aliases, metadata and all domain/blob bytes; retry recovers", async () => {
    await loadFrozen(); const before = await state();
    const fail = (_changes: unknown, key: unknown) => { if (key === "schemaVersion") throw new Error("injected-transition-failure"); };
    db.meta.hook("updating", fail);
    await expect(initializeDatabase(db)).rejects.toThrow("injected-transition-failure");
    expect(await state()).toEqual(before);
    expect(await initializeP1(old)).toMatchObject({ schemaVersion: 1, epoch: 1 });
    const map = new Map((await db.meta.toArray()).map(row => [row.key, row.value]));
    await expect(verifyAndGetSystemMeta(map, db)).rejects.toThrow("지원하지 않는 스키마");
    db.meta.hook.updating.unsubscribe(fail);
    expect(await initializeDatabase(db)).toMatchObject({ schemaVersion: 2, epoch: 2 });
    expect(await db.decisionLogs.toArray()).toEqual(before.decisionLogs);
    expect((await state()).mediaBlobs).toEqual(before.mediaBlobs);
  });

  for (const damage of ["fence", "missing-profile", "missing-generation", "profile-mismatch", "archived", "unsupported", "epoch-overflow", "empty-meta"] as const) {
    it(`transition ${damage} fails without changing any store`, async () => {
      await seedPlant();
      if (damage === "fence") await old.meta.update("writeFence", { value: true });
      if (damage === "missing-profile") await old.profiles.delete("p_default");
      if (damage === "missing-generation") await old.generationRegistry.delete(generation);
      if (damage === "profile-mismatch") await old.generationRegistry.update(generation, { profileId: "other" });
      if (damage === "archived") await old.generationRegistry.update(generation, { state: "ARCHIVED" });
      if (damage === "unsupported") await old.meta.update("schemaVersion", { value: 999 });
      if (damage === "epoch-overflow") await old.meta.update("epoch", { value: Number.MAX_SAFE_INTEGER });
      if (damage === "empty-meta") await old.meta.clear();
      const before = await state(); await expect(initializeDatabase(db)).rejects.toThrow(); expect(await state()).toEqual(before);
    });
  }

  for (const damage of ["body", "hash", "identity", "version", "alias-conflict", "consistent-but-wrong-body", "log-reference", "log-hash"] as const) {
    it(`R2/R3 legacy snapshot ${damage} aborts transition atomically`, async () => {
      await loadFrozen();
      const snapshot = (await db.ruleSnapshots.toArray())[0];
      if (damage === "body") await db.ruleSnapshots.update([generation, snapshot.id], { normalizedBody: '{"tampered":true}' });
      if (damage === "hash") await db.ruleSnapshots.update([generation, snapshot.id], { sha256: "0".repeat(64) });
      if (damage === "identity") await db.ruleSnapshots.update([generation, snapshot.id], { stableRuleId: "other" });
      if (damage === "version") await db.ruleSnapshots.update([generation, snapshot.id], { version: "other" });
      if (damage === "alias-conflict") {
        const body = canonical({ ...JSON.parse(snapshot.normalizedBody), inspectionDays: 30 });
        await db.ruleSnapshots.add({ ...snapshot, id: snapshot.stableRuleId, normalizedBody: body, sha256: await sha256(body) });
      }
      if (damage === "consistent-but-wrong-body") {
        const body = canonical({ ...JSON.parse(snapshot.normalizedBody), inspectionDays: 30 });
        await db.ruleSnapshots.update([generation, snapshot.id], { normalizedBody: body, sha256: await sha256(body) });
      }
      if (damage === "log-reference" || damage === "log-hash") {
        const log = (await db.decisionLogs.toArray())[0];
        await db.decisionLogs.update([generation, log.id], damage === "log-reference" ? { ruleSnapshotIds: ["missing"] } : { ruleSnapshotHash: "0".repeat(64) });
      }
      const before = await state(); await expect(initializeDatabase(db)).rejects.toThrow(); expect(await state()).toEqual(before);
    });
  }

  it("raw unused P1 fence helper does not downgrade the writer barrier", async () => {
    await initializeDatabase(db); await setP1Fence(old, false);
    expect((await db.meta.get("schemaVersion"))?.value).toBe(2);
    await expect(seedPlant()).rejects.toThrow("지원하지 않는 스키마");
  });
});

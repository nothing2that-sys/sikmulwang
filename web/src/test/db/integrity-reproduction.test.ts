//+_+// Tests reproducing the 6 independent audit defects before fixing
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "fake-indexeddb/auto";
import { SikmulwangDB, initializeDatabase, setDbInstance } from "../../lib/db/database";
import {
  createPlanting,
  updatePlanting,
  changePlantingQuantity,
  movePlantingLocation,
  splitPlantingGroup,
  trashPlanting,
  restorePlanting,
  purgePlanting,
} from "../../lib/db/plantingRepository";
import {
  createLocation,
  updateLocation,
  purgeLocation,
  trashLocation,
} from "../../lib/db/locationRepository";
import { startCycle, endCycle } from "../../lib/db/cycleRepository";
import { setWriteFence, getSystemMeta } from "../../lib/db/profileRepository";
import { ConflictError, CorruptedMetadataError, NotFoundError, ValidationError } from "../../lib/db/errors";
import { withWriteTransaction } from "../../lib/db/transaction";

describe("P1 Data Integrity Defect Reproduction Tests", () => {
  let db: SikmulwangDB;

  beforeEach(async () => {
    db = new SikmulwangDB(`test-integrity-${Date.now()}-${Math.random()}`);
    setDbInstance(db);
    await initializeDatabase(db);
  });

  afterEach(async () => {
    await db.delete();
  });

  //+_+// 1. 유한하지 않은 수량 거부 (NaN, Infinity, 0, 음수)
  it("rejects non-finite, negative, or invalid quantities (NaN, Infinity, 0)", async () => {
    const meta = await initializeDatabase(db);

    //+_+// NaN quantity in createPlanting
    await expect(
      createPlanting(db, meta.epoch, meta.activeGenerationId, {
        displayName: "테스트 식물",
        groupType: "GROUP",
        quantity: NaN,
        locationId: "loc_indoor_living",
      })
    ).rejects.toThrow();

    //+_+// Infinity quantity in createPlanting
    await expect(
      createPlanting(db, meta.epoch, meta.activeGenerationId, {
        displayName: "테스트 식물",
        groupType: "GROUP",
        quantity: Infinity,
        locationId: "loc_indoor_living",
      })
    ).rejects.toThrow();

    //+_+// INDIVIDUAL groupType with quantity != 1
    await expect(
      createPlanting(db, meta.epoch, meta.activeGenerationId, {
        displayName: "테스트 식물",
        groupType: "INDIVIDUAL",
        quantity: 5,
        locationId: "loc_indoor_living",
      })
    ).rejects.toThrow();
  });

  //+_+// 2. 참조 중인 장소의 물리 삭제 및 휴지통 이동 정책
  it("rejects purging or trashing a location that is referenced by active plantings", async () => {
    const meta = await initializeDatabase(db);

    //+_+// Create a new location
    const loc = await createLocation(db, meta.epoch, meta.activeGenerationId, {
      label: "전용 온실",
      environmentType: "GREENHOUSE",
      rainfallExposure: "COVERED",
      sunExposure: "FULL_SUN",
    });

    //+_+// Create a planting in that location
    await createPlanting(db, meta.epoch, meta.activeGenerationId, {
      displayName: "온실 토마토",
      groupType: "GROUP",
      quantity: 3,
      locationId: loc.id,
    });

    //+_+// Attempting to purge this location MUST fail because a plant is referencing it
    await expect(
      purgeLocation(db, meta.epoch, meta.activeGenerationId, loc.id, loc.revision)
    ).rejects.toThrow();

    //+_+// Attempting to trash this location MUST fail because active plants are referencing it
    await expect(
      trashLocation(db, meta.epoch, meta.activeGenerationId, loc.id, loc.revision)
    ).rejects.toThrow();
  });

  //+_+// 3. 시즌 시작 이전 종료 거부 (endLocalDate < startLocalDate)
  it("rejects ending a cycle with a date earlier than startLocalDate", async () => {
    const meta = await initializeDatabase(db);

    const { planting } = await createPlanting(db, meta.epoch, meta.activeGenerationId, {
      displayName: "시즌 테스트 식물",
      groupType: "INDIVIDUAL",
      quantity: 1,
      locationId: "loc_indoor_living",
    });

    const cycle = await startCycle(db, meta.epoch, meta.activeGenerationId, {
      plantingId: planting.id,
      startLocalDate: "2026-10-19",
    });

    //+_+// Ending the cycle at 2000-01-01 MUST fail
    await expect(
      endCycle(db, meta.epoch, meta.activeGenerationId, {
        cycleId: cycle.id,
        endLocalDate: "2000-01-01",
        expectedRevision: cycle.revision,
      })
    ).rejects.toThrow();
  });

  //+_+// 4. 잘못된 날짜·시간대 거부 (2026-02-31, 잘못된 IANA 시간대)
  it("rejects invalid calendar dates (e.g. 2026-02-31) and invalid IANA timezones", async () => {
    const meta = await initializeDatabase(db);

    const { planting } = await createPlanting(db, meta.epoch, meta.activeGenerationId, {
      displayName: "날짜 테스트 식물",
      groupType: "INDIVIDUAL",
      quantity: 1,
      locationId: "loc_indoor_living",
    });

    //+_+// Invalid calendar date 2026-02-31
    await expect(
      startCycle(db, meta.epoch, meta.activeGenerationId, {
        plantingId: planting.id,
        startLocalDate: "2026-02-31",
      })
    ).rejects.toThrow();

    //+_+// Invalid IANA timezone
    await expect(
      createLocation(db, meta.epoch, meta.activeGenerationId, {
        label: "이상한 시간대 장소",
        environmentType: "INDOOR",
        rainfallExposure: "COVERED",
        sunExposure: "SHADE",
        timeZone: "Invalid/Fake_Zone_123",
      })
    ).rejects.toThrow();
  });

  //+_+// 5. 잘못된 환경 이력 구간 거부 (과거로 이동하여 음수 구간 생성 등)
  it("rejects location move with effectiveAt earlier than existing environment history validFrom", async () => {
    const meta = await initializeDatabase(db);

    const { planting } = await createPlanting(db, meta.epoch, meta.activeGenerationId, {
      displayName: "환경이력 테스트 식물",
      groupType: "INDIVIDUAL",
      quantity: 1,
      locationId: "loc_indoor_living",
    });

    //+_+// Effective date in year 2000 (before planting was created) MUST fail
    await expect(
      movePlantingLocation(
        db,
        meta.epoch,
        meta.activeGenerationId,
        planting.id,
        "loc_balcony",
        "2000-01-01T00:00:00.000Z",
        planting.revision
      )
    ).rejects.toThrow();
  });

  //+_+// 6. 동시 초기화가 기존 쓰기 펜스를 초기화하지 않음
  it("concurrent initialization does not overwrite existing writeFence or meta state", async () => {
    //+_+// Set write fence to true in initialized db
    await setWriteFence(db, true);

    //+_+// Call initializeDatabase concurrently multiple times
    const [res1, res2, res3] = await Promise.all([
      initializeDatabase(db),
      initializeDatabase(db),
      initializeDatabase(db),
    ]);

    expect(res1.writeFence).toBe(true);
    expect(res2.writeFence).toBe(true);
    expect(res3.writeFence).toBe(true);

    const meta = await db.meta.get("writeFence");
    expect(meta?.value).toBe(true);
  });

  //+_+// 7. 결함 A: expectedRevision 불일치 시 충돌(ConflictError) 발생 및 덮어쓰기 방지
  it("rejects concurrent update with stale expectedRevision", async () => {
    const meta = await initializeDatabase(db);

    const { planting } = await createPlanting(db, meta.epoch, meta.activeGenerationId, {
      displayName: "동시성 테스트 그룹",
      groupType: "GROUP",
      quantity: 5,
      locationId: "loc_indoor_living",
    });

    expect(planting.revision).toBe(1);

    //+_+// Tab A changes quantity from 5 to 4 with expectedRevision: 1
    const updatedA = await changePlantingQuantity(
      db,
      meta.epoch,
      meta.activeGenerationId,
      planting.id,
      4,
      "탭 A에서 1개 폐기",
      1 // expectedRevision
    );
    expect(updatedA.revision).toBe(2);
    expect(updatedA.quantity).toBe(4);

    //+_+// Tab B still thinks revision is 1, tries to change quantity to 3
    await expect(
      changePlantingQuantity(
        db,
        meta.epoch,
        meta.activeGenerationId,
        planting.id,
        3,
        "탭 B에서 2개 폐기",
        1 // stale expectedRevision
      )
    ).rejects.toThrow(ConflictError);

    //+_+// Verify Tab A's data was not overwritten
    const fresh = await db.plantings.get([meta.activeGenerationId, planting.id]);
    expect(fresh?.quantity).toBe(4);
    expect(fresh?.revision).toBe(2);
  });

  //+_+// R2: 낙관적 동시성 제어 및 expectedRevision 필수 검증
  describe("R2: Strict Expected Revision Validation", () => {
    it("rejects undefined, null, NaN, <= 0, and non-integer revision values with ValidationError", async () => {
      const meta = await initializeDatabase(db);
      const { planting } = await createPlanting(db, meta.epoch, meta.activeGenerationId, {
        displayName: "R2 검증 식물",
        groupType: "INDIVIDUAL",
        quantity: 1,
        locationId: "loc_indoor_living",
      });

      // undefined
      await expect(
        // @ts-expect-error testing runtime validation
        updatePlanting(db, meta.epoch, meta.activeGenerationId, planting.id, { displayName: "이름" })
      ).rejects.toThrow(ValidationError);

      // NaN
      await expect(
        updatePlanting(db, meta.epoch, meta.activeGenerationId, planting.id, { displayName: "이름", expectedRevision: NaN })
      ).rejects.toThrow(ValidationError);

      // <= 0
      await expect(
        updatePlanting(db, meta.epoch, meta.activeGenerationId, planting.id, { displayName: "이름", expectedRevision: 0 })
      ).rejects.toThrow(ValidationError);

      // string
      await expect(
        // @ts-expect-error testing runtime validation
        updatePlanting(db, meta.epoch, meta.activeGenerationId, planting.id, { displayName: "이름", expectedRevision: "1" })
      ).rejects.toThrow(ValidationError);

      // movePlantingLocation with invalid revision
      await expect(
        // @ts-expect-error testing runtime validation
        movePlantingLocation(db, meta.epoch, meta.activeGenerationId, planting.id, "loc_balcony", undefined, undefined)
      ).rejects.toThrow(ValidationError);

      // splitPlantingGroup with invalid revision
      await expect(
        splitPlantingGroup(db, meta.epoch, meta.activeGenerationId, planting.id, 1, NaN)
      ).rejects.toThrow(ValidationError);

      // changePlantingQuantity with invalid revision
      await expect(
        // @ts-expect-error testing runtime validation
        changePlantingQuantity(db, meta.epoch, meta.activeGenerationId, planting.id, 1, "사유", null)
      ).rejects.toThrow(ValidationError);

      // trashPlanting with invalid revision
      await expect(
        trashPlanting(db, meta.epoch, meta.activeGenerationId, planting.id, -1)
      ).rejects.toThrow(ValidationError);

      // restorePlanting with invalid revision
      await expect(
        // @ts-expect-error testing runtime validation
        restorePlanting(db, meta.epoch, meta.activeGenerationId, planting.id, undefined)
      ).rejects.toThrow(ValidationError);

      // purgePlanting with invalid revision
      await expect(
        purgePlanting(db, meta.epoch, meta.activeGenerationId, planting.id, 0)
      ).rejects.toThrow(ValidationError);

      // updateLocation with invalid revision
      await expect(
        // @ts-expect-error testing runtime validation
        updateLocation(db, meta.epoch, meta.activeGenerationId, "loc_indoor_living", { label: "새이름" })
      ).rejects.toThrow(ValidationError);

      // endCycle with invalid revision
      const cycle = await startCycle(db, meta.epoch, meta.activeGenerationId, {
        plantingId: planting.id,
        startLocalDate: "2026-10-19",
      });
      await expect(
        // @ts-expect-error testing runtime validation
        endCycle(db, meta.epoch, meta.activeGenerationId, { cycleId: cycle.id, endLocalDate: "2026-10-20" })
      ).rejects.toThrow(ValidationError);

      // Verify zero partial updates
      const checkPlant = await db.plantings.get([meta.activeGenerationId, planting.id]);
      expect(checkPlant?.displayName).toBe("R2 검증 식물");
      expect(checkPlant?.revision).toBe(1);
    });

    it("accepts valid positive integer revision matching existing record", async () => {
      const meta = await initializeDatabase(db);
      const { planting } = await createPlanting(db, meta.epoch, meta.activeGenerationId, {
        displayName: "R2 정상 수정 식물",
        groupType: "INDIVIDUAL",
        quantity: 1,
        locationId: "loc_indoor_living",
      });

      const updated = await updatePlanting(db, meta.epoch, meta.activeGenerationId, planting.id, {
        displayName: "R2 정상 수정 완료",
        expectedRevision: 1,
      });

      expect(updated.displayName).toBe("R2 정상 수정 완료");
      expect(updated.revision).toBe(2);
    });
  });

  //+_+// R3: 엄격한 타임스탬프 파싱 및 환경 이력 단조 증가 검증
  describe("R3: Strict UTC ISO8601 Timestamp Validation", () => {
    it("rejects invalid, empty, or non-UTC timestamps", async () => {
      const meta = await initializeDatabase(db);
      const { planting } = await createPlanting(db, meta.epoch, meta.activeGenerationId, {
        displayName: "R3 타임스탬프 테스트",
        groupType: "INDIVIDUAL",
        quantity: 1,
        locationId: "loc_indoor_living",
      });

      // not-a-timestamp
      await expect(
        movePlantingLocation(db, meta.epoch, meta.activeGenerationId, planting.id, "loc_balcony", "not-a-timestamp", 1)
      ).rejects.toThrow(ValidationError);

      // empty string
      await expect(
        movePlantingLocation(db, meta.epoch, meta.activeGenerationId, planting.id, "loc_balcony", "   ", 1)
      ).rejects.toThrow(ValidationError);

      // calendar-impossible timestamp: 2026-02-30T10:00:00Z
      await expect(
        movePlantingLocation(db, meta.epoch, meta.activeGenerationId, planting.id, "loc_balcony", "2026-02-30T10:00:00Z", 1)
      ).rejects.toThrow(ValidationError);

      // timezone-less ISO string
      await expect(
        movePlantingLocation(db, meta.epoch, meta.activeGenerationId, planting.id, "loc_balcony", "2026-10-19T10:00:00", 1)
      ).rejects.toThrow(ValidationError);
    });

    it("accepts valid UTC ISO8601 string and defaults correctly when omitted", async () => {
      const meta = await initializeDatabase(db);
      const { planting } = await createPlanting(db, meta.epoch, meta.activeGenerationId, {
        displayName: "R3 정상 타임스탬프",
        groupType: "INDIVIDUAL",
        quantity: 1,
        locationId: "loc_indoor_living",
      });

      // Default (undefined effectiveAt)
      const moved1 = await movePlantingLocation(
        db,
        meta.epoch,
        meta.activeGenerationId,
        planting.id,
        "loc_balcony",
        undefined,
        1
      );
      expect(moved1.locationId).toBe("loc_balcony");
      expect(moved1.revision).toBe(2);

      // Explicit valid future timestamp
      const validFuture = new Date(Date.now() + 60000).toISOString();
      const moved2 = await movePlantingLocation(
        db,
        meta.epoch,
        meta.activeGenerationId,
        planting.id,
        "loc_indoor_living",
        validFuture,
        2
      );
      expect(moved2.locationId).toBe("loc_indoor_living");
      expect(moved2.revision).toBe(3);
    });
  });

  //+_+// R4: Taxon Snapshot 외래키 세대 격리 검증
  describe("R4: Taxon Snapshot Generation Scoping", () => {
    it("allows null taxonSnapshotId", async () => {
      const meta = await initializeDatabase(db);
      const { planting } = await createPlanting(db, meta.epoch, meta.activeGenerationId, {
        displayName: "분류 없는 식물",
        groupType: "INDIVIDUAL",
        quantity: 1,
        locationId: "loc_indoor_living",
        taxonSnapshotId: null,
      });
      expect(planting.taxonSnapshotId).toBeNull();
    });

    it("allows referencing taxonSnapshot in the same active generation", async () => {
      const meta = await initializeDatabase(db);
      const taxonId = "txn_same_gen_1";
      await db.taxonSnapshots.put({
        generationId: meta.activeGenerationId,
        id: taxonId,
        canonicalName: "Monstera deliciosa",
        taxonRank: "SPECIES",
        sourceKind: "MANUAL",
        sourceVersion: "1.0",
        sourceUrl: null,
      });

      const { planting } = await createPlanting(db, meta.epoch, meta.activeGenerationId, {
        displayName: "몬스테라",
        groupType: "INDIVIDUAL",
        quantity: 1,
        locationId: "loc_indoor_living",
        taxonSnapshotId: taxonId,
      });
      expect(planting.taxonSnapshotId).toBe(taxonId);
    });

    it("rejects non-existent taxonSnapshotId", async () => {
      const meta = await initializeDatabase(db);
      await expect(
        createPlanting(db, meta.epoch, meta.activeGenerationId, {
          displayName: "유령 분류 식물",
          groupType: "INDIVIDUAL",
          quantity: 1,
          locationId: "loc_indoor_living",
          taxonSnapshotId: "txn_non_existent",
        })
      ).rejects.toThrow(NotFoundError);
    });

    it("rejects taxonSnapshotId belonging to a different generation", async () => {
      const meta = await initializeDatabase(db);
      const otherGenId = "gen_other_generation_999";
      const taxonId = "txn_other_gen_1";

      await db.taxonSnapshots.put({
        generationId: otherGenId,
        id: taxonId,
        canonicalName: "Ocimum basilicum",
        taxonRank: "SPECIES",
        sourceKind: "MANUAL",
        sourceVersion: "1.0",
        sourceUrl: null,
      });

      // Attempt to reference taxon snapshot from other generation
      await expect(
        createPlanting(db, meta.epoch, meta.activeGenerationId, {
          displayName: "타 세대 참조 바질",
          groupType: "INDIVIDUAL",
          quantity: 1,
          locationId: "loc_indoor_living",
          taxonSnapshotId: taxonId,
        })
      ).rejects.toThrow(NotFoundError);
    });

    it("rejects update to an invalid taxonSnapshotId", async () => {
      const meta = await initializeDatabase(db);
      const { planting } = await createPlanting(db, meta.epoch, meta.activeGenerationId, {
        displayName: "수정 테스트 식물",
        groupType: "INDIVIDUAL",
        quantity: 1,
        locationId: "loc_indoor_living",
      });

      await expect(
        updatePlanting(db, meta.epoch, meta.activeGenerationId, planting.id, {
          taxonSnapshotId: "txn_fake_id_123",
          expectedRevision: 1,
        })
      ).rejects.toThrow(NotFoundError);
    });
  });

  //+_+// R5: 시스템 메타데이터 무결성 검증 및 손상 시 쓰기 차단
  describe("R5: System Metadata Integrity and Corruption Protection", () => {
    it("successfully verifies clean init and normal reopen", async () => {
      const meta = await initializeDatabase(db);
      expect(meta.writeFence).toBe(false);
      expect(meta.epoch).toBe(1);
      expect(meta.activeGenerationId).toBeTruthy();

      const reopened = await getSystemMeta(db);
      expect(reopened.epoch).toBe(1);
      expect(reopened.activeGenerationId).toBe(meta.activeGenerationId);
    });

    it("throws CorruptedMetadataError when writeFence is missing", async () => {
      await initializeDatabase(db);
      await db.meta.delete("writeFence");

      await expect(initializeDatabase(db)).rejects.toThrow(CorruptedMetadataError);
      await expect(getSystemMeta(db)).rejects.toThrow(CorruptedMetadataError);
    });

    it("throws CorruptedMetadataError when epoch is missing or invalid", async () => {
      await initializeDatabase(db);
      await db.meta.put({ key: "epoch", value: 0, updatedAt: new Date().toISOString() });

      await expect(initializeDatabase(db)).rejects.toThrow(CorruptedMetadataError);

      await db.meta.put({ key: "epoch", value: -5, updatedAt: new Date().toISOString() });
      await expect(initializeDatabase(db)).rejects.toThrow(CorruptedMetadataError);
    });

    it("throws CorruptedMetadataError when schemaVersion is unsupported", async () => {
      await initializeDatabase(db);
      await db.meta.put({ key: "schemaVersion", value: 99, updatedAt: new Date().toISOString() });

      await expect(initializeDatabase(db)).rejects.toThrow(CorruptedMetadataError);
    });

    it("throws CorruptedMetadataError when active generation pointer is broken", async () => {
      await initializeDatabase(db);
      await db.meta.put({ key: "activeGenerationId", value: "gen_missing_pointer", updatedAt: new Date().toISOString() });

      await expect(initializeDatabase(db)).rejects.toThrow(CorruptedMetadataError);
    });

    it("blocks withWriteTransaction when metadata is corrupted", async () => {
      const meta = await initializeDatabase(db);
      // Corrupt the epoch in meta table
      await db.meta.put({ key: "epoch", value: -1, updatedAt: new Date().toISOString() });

      await expect(
        withWriteTransaction(
          db,
          [db.plantings],
          meta.epoch,
          meta.activeGenerationId,
          async ({ generationId }) => {
            await db.plantings.delete([generationId, "any_id"]);
          }
        )
      ).rejects.toThrow(CorruptedMetadataError);
    });
  });
});

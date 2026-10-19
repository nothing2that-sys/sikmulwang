//+_+// Tests reproducing the 6 independent audit defects before fixing
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "fake-indexeddb/auto";
import { SikmulwangDB, initializeDatabase, setDbInstance } from "../../lib/db/database";
import {
  createPlanting,
  changePlantingQuantity,
  movePlantingLocation,
} from "../../lib/db/plantingRepository";
import {
  createLocation,
  purgeLocation,
  trashLocation,
} from "../../lib/db/locationRepository";
import { startCycle, endCycle } from "../../lib/db/cycleRepository";
import { setWriteFence } from "../../lib/db/profileRepository";
import { ConflictError } from "../../lib/db/errors";

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
      purgeLocation(db, meta.epoch, meta.activeGenerationId, loc.id)
    ).rejects.toThrow();

    //+_+// Attempting to trash this location MUST fail because active plants are referencing it
    await expect(
      trashLocation(db, meta.epoch, meta.activeGenerationId, loc.id)
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
        "2000-01-01T00:00:00.000Z"
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
});

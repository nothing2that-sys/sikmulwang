//+_+// Comprehensive unit and integration tests for P1 local data foundation
import { describe, it, expect, beforeEach } from "vitest";
import { SikmulwangDB, initializeDatabase } from "../../lib/db/database";
import {
  createLocation,
  listLocations,
  updateLocation,
  trashLocation,
  restoreLocation,
  purgeLocation,
} from "../../lib/db/locationRepository";
import {
  createPlanting,
  listPlantings,
  getPlantingById,
  movePlantingLocation,
  splitPlantingGroup,
  changePlantingQuantity,
  trashPlanting,
  restorePlanting,
  purgePlanting,
  getEnvironmentHistories,
} from "../../lib/db/plantingRepository";
import {
  startCycle,
  endCycle,
  getActiveCycle,
  listCyclesByPlanting,
} from "../../lib/db/cycleRepository";
import {
  getSystemMeta,
  setWriteFence,
  bumpEpoch,
} from "../../lib/db/profileRepository";
import {
  StaleSessionError,
  WriteFenceActiveError,
  ValidationError,
} from "../../lib/db/errors";

describe("P1 Local Data Foundation — IndexedDB & Repositories", () => {
  let db: SikmulwangDB;
  let epoch: number;
  let generationId: string;

  beforeEach(async () => {
    //+_+// Unique test database per test case
    const testDbName = `test-db-${crypto.randomUUID()}`;
    db = new SikmulwangDB(testDbName);
    const meta = await initializeDatabase(db);
    epoch = meta.epoch;
    generationId = meta.activeGenerationId;
  });

  describe("Database initialization and meta management", () => {
    it("initializes meta, default profile, default generation, and default locations", async () => {
      const meta = await getSystemMeta(db);
      expect(meta.activeProfileId).toBe("p_default");
      expect(meta.activeGenerationId).toBe("g_default");
      expect(meta.epoch).toBe(1);
      expect(meta.writeFence).toBe(false);
      expect(meta.schemaVersion).toBe(1);

      const locations = await listLocations(db, meta.activeGenerationId);
      expect(locations).toHaveLength(3);
      expect(locations.map((l) => l.label)).toContain("거실 창가 (실내)");
      expect(locations.map((l) => l.label)).toContain("베란다 정원 (베란다)");
      expect(locations.map((l) => l.label)).toContain("마당 화단 (야외)");
    });
  });

  describe("Location repository CRUD and tombstone", () => {
    it("creates, updates, trashes, restores, and purges locations", async () => {
      const newLoc = await createLocation(db, epoch, generationId, {
        label: "서재 책상 위",
        environmentType: "INDOOR",
        rainfallExposure: "COVERED",
        sunExposure: "PARTIAL_SUN",
      });

      expect(newLoc.id).toMatch(/^loc_/);
      expect(newLoc.label).toBe("서재 책상 위");
      expect(newLoc.recordStatus).toBe("ACTIVE");

      //+_+// Update location
      const updated = await updateLocation(db, epoch, generationId, newLoc.id, {
        label: "서재 남향 창가",
        sunExposure: "FULL_SUN",
      });
      expect(updated.label).toBe("서재 남향 창가");
      expect(updated.sunExposure).toBe("FULL_SUN");
      expect(updated.revision).toBe(2);

      //+_+// Trash location
      await trashLocation(db, epoch, generationId, newLoc.id);
      const activeLocs = await listLocations(db, generationId, {
        includeTrashed: false,
      });
      expect(activeLocs.some((l) => l.id === newLoc.id)).toBe(false);

      const allLocs = await listLocations(db, generationId, {
        includeTrashed: true,
      });
      expect(allLocs.some((l) => l.id === newLoc.id)).toBe(true);

      //+_+// Restore location
      await restoreLocation(db, epoch, generationId, newLoc.id);
      const restoredLocs = await listLocations(db, generationId);
      expect(restoredLocs.some((l) => l.id === newLoc.id)).toBe(true);

      //+_+// Purge location
      await purgeLocation(db, epoch, generationId, newLoc.id);
      const afterPurge = await listLocations(db, generationId, {
        includeTrashed: true,
      });
      expect(afterPurge.some((l) => l.id === newLoc.id)).toBe(false);
    });

    it("rejects empty location label", async () => {
      await expect(
        createLocation(db, epoch, generationId, {
          label: "   ",
          environmentType: "INDOOR",
          rainfallExposure: "COVERED",
          sunExposure: "SHADE",
        })
      ).rejects.toThrow(ValidationError);
    });
  });

  describe("Planting registration and environment history", () => {
    it("registers individual plant and automatically creates initial environment history and cycle", async () => {
      const locations = await listLocations(db, generationId);
      const targetLoc = locations[0];

      const { planting, cycle } = await createPlanting(db, epoch, generationId, {
        displayName: "초록이 몬스테라",
        groupType: "INDIVIDUAL",
        quantity: 1,
        unit: "그루",
        locationId: targetLoc.id,
        growingStatus: "GROWING",
        startLocalDate: "2026-10-19",
      });

      expect(planting.id).toMatch(/^plt_/);
      expect(planting.displayName).toBe("초록이 몬스테라");
      expect(planting.recordStatus).toBe("ACTIVE");
      expect(cycle).toBeDefined();
      expect(cycle?.status).toBe("ACTIVE");
      expect(cycle?.startLocalDate).toBe("2026-10-19");

      //+_+// Verify environment history snapshot
      const histories = await getEnvironmentHistories(
        db,
        generationId,
        planting.id
      );
      expect(histories).toHaveLength(1);
      expect(histories[0].locationId).toBe(targetLoc.id);
      expect(histories[0].validTo).toBeNull();
      expect(histories[0].environmentSnapshot.label).toBe(targetLoc.label);
    });

    it("moves plant to new location, updating environment history without overlap", async () => {
      const locations = await listLocations(db, generationId);
      const loc1 = locations[0];
      const loc2 = locations[1];

      const { planting } = await createPlanting(db, epoch, generationId, {
        displayName: "테스트 산세베리아",
        groupType: "INDIVIDUAL",
        quantity: 1,
        locationId: loc1.id,
      });

      const moveTime = "2026-10-19T10:00:00.000Z";
      const movedPlanting = await movePlantingLocation(
        db,
        epoch,
        generationId,
        planting.id,
        loc2.id,
        moveTime
      );

      expect(movedPlanting.locationId).toBe(loc2.id);

      const histories = await getEnvironmentHistories(
        db,
        generationId,
        planting.id
      );
      expect(histories).toHaveLength(2);

      //+_+// First history closed at moveTime
      const oldHist = histories.find((h) => h.locationId === loc1.id);
      expect(oldHist?.validTo).toBe(moveTime);

      //+_+// Second history started at moveTime
      const newHist = histories.find((h) => h.locationId === loc2.id);
      expect(newHist?.validFrom).toBe(moveTime);
      expect(newHist?.validTo).toBeNull();
      expect(newHist?.environmentSnapshot.label).toBe(loc2.label);
    });

    it("splits group planting correctly, preserving source history and tracking splitFromPlantingId", async () => {
      const locations = await listLocations(db, generationId);
      const loc = locations[0];

      const { planting: groupPlanting } = await createPlanting(
        db,
        epoch,
        generationId,
        {
          displayName: "방울토마토 모종",
          groupType: "GROUP",
          quantity: 5,
          unit: "포기",
          locationId: loc.id,
        }
      );

      const { source, split } = await splitPlantingGroup(
        db,
        epoch,
        generationId,
        groupPlanting.id,
        2,
        "방울토마토 2호",
        "지인 분양 준비"
      );

      expect(source.quantity).toBe(3);
      expect(source.quantityChangeReason).toContain("수량 감소");

      expect(split.displayName).toBe("방울토마토 2호");
      expect(split.quantity).toBe(2);
      expect(split.splitFromPlantingId).toBe(groupPlanting.id);
      expect(split.quantityChangeReason).toContain("분할 생성");

      //+_+// Both have valid environment histories
      const splitHistories = await getEnvironmentHistories(
        db,
        generationId,
        split.id
      );
      expect(splitHistories).toHaveLength(1);
      expect(splitHistories[0].locationId).toBe(loc.id);
    });

    it("rejects invalid group splitting attempts", async () => {
      const locations = await listLocations(db, generationId);
      const { planting: singlePlant } = await createPlanting(
        db,
        epoch,
        generationId,
        {
          displayName: "단일 화분",
          groupType: "INDIVIDUAL",
          quantity: 1,
          locationId: locations[0].id,
        }
      );

      //+_+// Splitting individual plant is prohibited
      await expect(
        splitPlantingGroup(
          db,
          epoch,
          generationId,
          singlePlant.id,
          1,
          "분할 화분"
        )
      ).rejects.toThrow(ValidationError);
    });

    it("updates quantity with required audit reason", async () => {
      const locations = await listLocations(db, generationId);
      const { planting } = await createPlanting(db, epoch, generationId, {
        displayName: "다육이 모둠",
        groupType: "GROUP",
        quantity: 4,
        unit: "개",
        locationId: locations[0].id,
      });

      const updated = await changePlantingQuantity(
        db,
        epoch,
        generationId,
        planting.id,
        3,
        "1개 분갈이 중 손상으로 폐기"
      );

      expect(updated.quantity).toBe(3);
      expect(updated.quantityChangeReason).toBe("1개 분갈이 중 손상으로 폐기");

      //+_+// Empty reason rejected
      await expect(
        changePlantingQuantity(db, epoch, generationId, planting.id, 2, "   ")
      ).rejects.toThrow(ValidationError);
    });

    it("manages planting soft deletion (TRASHED), restoration, and purging", async () => {
      const locations = await listLocations(db, generationId);
      const { planting } = await createPlanting(db, epoch, generationId, {
        displayName: "임시 식물",
        groupType: "INDIVIDUAL",
        quantity: 1,
        locationId: locations[0].id,
      });

      await trashPlanting(db, epoch, generationId, planting.id);
      const activeList = await listPlantings(db, generationId, {
        includeTrashed: false,
      });
      expect(activeList.some((p) => p.id === planting.id)).toBe(false);

      const allList = await listPlantings(db, generationId, {
        includeTrashed: true,
      });
      const trashed = allList.find((p) => p.id === planting.id);
      expect(trashed?.recordStatus).toBe("TRASHED");

      await restorePlanting(db, epoch, generationId, planting.id);
      const restored = await getPlantingById(db, generationId, planting.id);
      expect(restored?.recordStatus).toBe("ACTIVE");

      await purgePlanting(db, epoch, generationId, planting.id);
      const purged = await getPlantingById(db, generationId, planting.id);
      expect(purged).toBeUndefined();
    });
  });

  describe("Cycle/Season lifecycle and single active cycle constraint", () => {
    it("enforces single active cycle per planting and manages season start/end", async () => {
      const locations = await listLocations(db, generationId);
      const { planting } = await createPlanting(db, epoch, generationId, {
        displayName: "바질 화분",
        groupType: "INDIVIDUAL",
        quantity: 1,
        locationId: locations[0].id,
        startLocalDate: "2026-04-01",
      });

      const activeCycle1 = await getActiveCycle(db, generationId, planting.id);
      expect(activeCycle1).toBeDefined();
      expect(activeCycle1?.status).toBe("ACTIVE");

      //+_+// Attempting to start second active cycle must be rejected
      await expect(
        startCycle(db, epoch, generationId, {
          plantingId: planting.id,
          startLocalDate: "2026-05-01",
        })
      ).rejects.toThrow(ValidationError);

      //+_+// End the first cycle
      const ended = await endCycle(db, epoch, generationId, {
        cycleId: activeCycle1!.id,
        endLocalDate: "2026-08-31",
      });
      expect(ended.status).toBe("ENDED");
      expect(ended.endLocalDate).toBe("2026-08-31");

      const noActive = await getActiveCycle(db, generationId, planting.id);
      expect(noActive).toBeUndefined();

      //+_+// Now second cycle can be started cleanly
      const cycle2 = await startCycle(db, epoch, generationId, {
        plantingId: planting.id,
        startLocalDate: "2026-09-01",
      });
      expect(cycle2.status).toBe("ACTIVE");

      const allCycles = await listCyclesByPlanting(
        db,
        generationId,
        planting.id
      );
      expect(allCycles).toHaveLength(2);
    });
  });

  describe("Concurrency, write fence, and stale session controls", () => {
    it("blocks writes when epoch does not match (StaleSessionError)", async () => {
      const locations = await listLocations(db, generationId);

      //+_+// Bump epoch in database
      await bumpEpoch(db);

      //+_+// Old epoch write attempt must be blocked
      await expect(
        createPlanting(db, epoch, generationId, {
          displayName: "구버전 탭 등록 식물",
          groupType: "INDIVIDUAL",
          quantity: 1,
          locationId: locations[0].id,
        })
      ).rejects.toThrow(StaleSessionError);
    });

    it("blocks writes when writeFence is active (WriteFenceActiveError)", async () => {
      const locations = await listLocations(db, generationId);

      //+_+// Activate write fence
      await setWriteFence(db, true);

      //+_+// Any domain write must be blocked
      await expect(
        createPlanting(db, epoch, generationId, {
          displayName: "백업 중 등록 시도 식물",
          groupType: "INDIVIDUAL",
          quantity: 1,
          locationId: locations[0].id,
        })
      ).rejects.toThrow(WriteFenceActiveError);

      //+_+// Release write fence
      await setWriteFence(db, false);

      const success = await createPlanting(db, epoch, generationId, {
        displayName: "펜스 해제 후 등록 성공",
        groupType: "INDIVIDUAL",
        quantity: 1,
        locationId: locations[0].id,
      });
      expect(success.planting.displayName).toBe("펜스 해제 후 등록 성공");
    });
  });
});

//+_+// React Context providing reactive IndexedDB state and actions with optimistic concurrency and error resilience
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import {
  getDb,
  initializeDatabase,
  type SikmulwangDB,
} from "./database";
import type {
  LocationRecord,
  PlantingRecord,
  CycleRecord,
} from "./types";
import {
  listLocations,
  createLocation,
  updateLocation,
  trashLocation,
  restoreLocation,
  purgeLocation,
  type CreateLocationParams,
  type UpdateLocationParams,
} from "./locationRepository";
import {
  listPlantings,
  createPlanting,
  updatePlanting,
  movePlantingLocation,
  splitPlantingGroup,
  changePlantingQuantity,
  trashPlanting,
  restorePlanting,
  purgePlanting,
  type CreatePlantingParams,
  type UpdatePlantingParams,
} from "./plantingRepository";
import {
  startCycle as startCycleAction,
  endCycle as endCycleAction,
  getActiveCycle as getActiveCycleAction,
  listCyclesByPlanting as listCyclesByPlantingAction,
} from "./cycleRepository";
import {
  getSystemMeta,
  setWriteFence as setWriteFenceAction,
  type SystemMetaState,
} from "./profileRepository";

export interface DbContextValue {
  isReady: boolean;
  error: Error | null;
  db: SikmulwangDB;
  meta: SystemMetaState | null;
  locations: LocationRecord[];
  trashedLocations: LocationRecord[];
  plantings: PlantingRecord[];
  trashedPlantings: PlantingRecord[];
  refresh: () => Promise<void>;

  //+_+// Location actions
  addLocation: (params: CreateLocationParams) => Promise<LocationRecord>;
  editLocation: (
    id: string,
    params: UpdateLocationParams,
    expectedRevision?: number
  ) => Promise<LocationRecord>;
  removeLocation: (id: string, expectedRevision?: number) => Promise<void>;
  restoreLocationItem: (id: string, expectedRevision?: number) => Promise<void>;
  purgeLocationItem: (id: string, expectedRevision?: number) => Promise<void>;

  //+_+// Planting actions
  addPlanting: (
    params: CreatePlantingParams
  ) => Promise<{ planting: PlantingRecord; cycle?: CycleRecord }>;
  editPlanting: (
    id: string,
    params: UpdatePlantingParams,
    expectedRevision?: number
  ) => Promise<PlantingRecord>;
  movePlanting: (
    id: string,
    newLocationId: string,
    effectiveAt?: string,
    expectedRevision?: number
  ) => Promise<PlantingRecord>;
  splitPlanting: (
    id: string,
    splitQuantity: number,
    newDisplayName?: string,
    reason?: string,
    expectedRevision?: number
  ) => Promise<{ source: PlantingRecord; split: PlantingRecord }>;
  changeQuantity: (
    id: string,
    newQuantity: number,
    reason: string,
    expectedRevision?: number
  ) => Promise<PlantingRecord>;
  removePlanting: (id: string, expectedRevision?: number) => Promise<void>;
  restorePlantingItem: (id: string, expectedRevision?: number) => Promise<void>;
  purgePlantingItem: (id: string, expectedRevision?: number) => Promise<void>;

  //+_+// Cycle actions
  startNewCycle: (plantingId: string, startLocalDate: string) => Promise<CycleRecord>;
  finishCycle: (
    cycleId: string,
    endLocalDate: string,
    expectedRevision?: number
  ) => Promise<CycleRecord>;
  getActiveCycleForPlanting: (plantingId: string) => Promise<CycleRecord | undefined>;
  getCyclesForPlanting: (plantingId: string) => Promise<CycleRecord[]>;

  //+_+// Meta / Fence controls
  setWriteFenceState: (active: boolean) => Promise<void>;
}

const DbContext = createContext<DbContextValue | null>(null);

export function DbProvider({ children }: { children: ReactNode }) {
  const [db] = useState(() => getDb());
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [meta, setMeta] = useState<SystemMetaState | null>(null);
  const [locations, setLocations] = useState<LocationRecord[]>([]);
  const [trashedLocations, setTrashedLocations] = useState<LocationRecord[]>([]);
  const [plantings, setPlantings] = useState<PlantingRecord[]>([]);
  const [trashedPlantings, setTrashedPlantings] = useState<PlantingRecord[]>([]);

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const initMeta = await initializeDatabase(db);
      const currentMeta = await getSystemMeta(db);
      const activeGen = currentMeta.activeGenerationId || initMeta.activeGenerationId;

      const [allLocs, activePlts, allPlts] = await Promise.all([
        listLocations(db, activeGen, { includeTrashed: true }),
        listPlantings(db, activeGen, { includeTrashed: false }),
        listPlantings(db, activeGen, { includeTrashed: true }),
      ]);

      setMeta(currentMeta);
      setLocations(allLocs.filter((l) => l.recordStatus === "ACTIVE"));
      setTrashedLocations(allLocs.filter((l) => l.recordStatus === "TRASHED"));
      setPlantings(activePlts);
      setTrashedPlantings(allPlts.filter((p) => p.recordStatus === "TRASHED"));
      setIsReady(true);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, [db]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const initMeta = await initializeDatabase(db);
        const currentMeta = await getSystemMeta(db);
        const activeGen =
          currentMeta.activeGenerationId || initMeta.activeGenerationId;

        const [allLocs, activePlts, allPlts] = await Promise.all([
          listLocations(db, activeGen, { includeTrashed: true }),
          listPlantings(db, activeGen, { includeTrashed: false }),
          listPlantings(db, activeGen, { includeTrashed: true }),
        ]);

        if (!mounted) return;
        setMeta(currentMeta);
        setLocations(allLocs.filter((l) => l.recordStatus === "ACTIVE"));
        setTrashedLocations(allLocs.filter((l) => l.recordStatus === "TRASHED"));
        setPlantings(activePlts);
        setTrashedPlantings(allPlts.filter((p) => p.recordStatus === "TRASHED"));
        setIsReady(true);
      } catch (err) {
        if (!mounted) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    })();

    //+_+// Listen for database version changes across tabs
    const handleVersionChange = () => {
      setError(
        new Error(
          "다른 탭에서 데이터베이스 버전이 갱신되었습니다. 최신 버전을 적용하기 위해 페이지를 새로고침해 주세요."
        )
      );
    };

    if (db.on) {
      db.on("versionchange", handleVersionChange);
    }

    return () => {
      mounted = false;
      if (db.on) {
        db.on.versionchange.unsubscribe(handleVersionChange);
      }
    };
  }, [db]);

  const addLocation = useCallback(
    async (params: CreateLocationParams) => {
      if (!meta) throw new Error("데이터베이스가 초기화되지 않았습니다.");
      const res = await createLocation(
        db,
        meta.epoch,
        meta.activeGenerationId,
        params
      );
      await loadData();
      return res;
    },
    [db, meta, loadData]
  );

  const editLocation = useCallback(
    async (
      id: string,
      params: UpdateLocationParams,
      expectedRevision?: number
    ) => {
      if (!meta) throw new Error("데이터베이스가 초기화되지 않았습니다.");
      const res = await updateLocation(
        db,
        meta.epoch,
        meta.activeGenerationId,
        id,
        { ...params, expectedRevision }
      );
      await loadData();
      return res;
    },
    [db, meta, loadData]
  );

  const removeLocation = useCallback(
    async (id: string, expectedRevision?: number) => {
      if (!meta) throw new Error("데이터베이스가 초기화되지 않았습니다.");
      await trashLocation(
        db,
        meta.epoch,
        meta.activeGenerationId,
        id,
        expectedRevision
      );
      await loadData();
    },
    [db, meta, loadData]
  );

  const restoreLocationItem = useCallback(
    async (id: string, expectedRevision?: number) => {
      if (!meta) throw new Error("데이터베이스가 초기화되지 않았습니다.");
      await restoreLocation(
        db,
        meta.epoch,
        meta.activeGenerationId,
        id,
        expectedRevision
      );
      await loadData();
    },
    [db, meta, loadData]
  );

  const purgeLocationItem = useCallback(
    async (id: string, expectedRevision?: number) => {
      if (!meta) throw new Error("데이터베이스가 초기화되지 않았습니다.");
      await purgeLocation(
        db,
        meta.epoch,
        meta.activeGenerationId,
        id,
        expectedRevision
      );
      await loadData();
    },
    [db, meta, loadData]
  );

  const addPlanting = useCallback(
    async (params: CreatePlantingParams) => {
      if (!meta) throw new Error("데이터베이스가 초기화되지 않았습니다.");
      const res = await createPlanting(
        db,
        meta.epoch,
        meta.activeGenerationId,
        params
      );
      await loadData();
      return res;
    },
    [db, meta, loadData]
  );

  const editPlanting = useCallback(
    async (
      id: string,
      params: UpdatePlantingParams,
      expectedRevision?: number
    ) => {
      if (!meta) throw new Error("데이터베이스가 초기화되지 않았습니다.");
      const res = await updatePlanting(
        db,
        meta.epoch,
        meta.activeGenerationId,
        id,
        { ...params, expectedRevision }
      );
      await loadData();
      return res;
    },
    [db, meta, loadData]
  );

  const movePlanting = useCallback(
    async (
      id: string,
      newLocationId: string,
      effectiveAt?: string,
      expectedRevision?: number
    ) => {
      if (!meta) throw new Error("데이터베이스가 초기화되지 않았습니다.");
      const res = await movePlantingLocation(
        db,
        meta.epoch,
        meta.activeGenerationId,
        id,
        newLocationId,
        effectiveAt,
        expectedRevision
      );
      await loadData();
      return res;
    },
    [db, meta, loadData]
  );

  const splitPlanting = useCallback(
    async (
      id: string,
      splitQuantity: number,
      newDisplayName?: string,
      reason?: string,
      expectedRevision?: number
    ) => {
      if (!meta) throw new Error("데이터베이스가 초기화되지 않았습니다.");
      const res = await splitPlantingGroup(
        db,
        meta.epoch,
        meta.activeGenerationId,
        id,
        splitQuantity,
        newDisplayName,
        reason,
        expectedRevision
      );
      await loadData();
      return res;
    },
    [db, meta, loadData]
  );

  const changeQuantity = useCallback(
    async (
      id: string,
      newQuantity: number,
      reason: string,
      expectedRevision?: number
    ) => {
      if (!meta) throw new Error("데이터베이스가 초기화되지 않았습니다.");
      const res = await changePlantingQuantity(
        db,
        meta.epoch,
        meta.activeGenerationId,
        id,
        newQuantity,
        reason,
        expectedRevision
      );
      await loadData();
      return res;
    },
    [db, meta, loadData]
  );

  const removePlanting = useCallback(
    async (id: string, expectedRevision?: number) => {
      if (!meta) throw new Error("데이터베이스가 초기화되지 않았습니다.");
      await trashPlanting(
        db,
        meta.epoch,
        meta.activeGenerationId,
        id,
        expectedRevision
      );
      await loadData();
    },
    [db, meta, loadData]
  );

  const restorePlantingItem = useCallback(
    async (id: string, expectedRevision?: number) => {
      if (!meta) throw new Error("데이터베이스가 초기화되지 않았습니다.");
      await restorePlanting(
        db,
        meta.epoch,
        meta.activeGenerationId,
        id,
        expectedRevision
      );
      await loadData();
    },
    [db, meta, loadData]
  );

  const purgePlantingItem = useCallback(
    async (id: string, expectedRevision?: number) => {
      if (!meta) throw new Error("데이터베이스가 초기화되지 않았습니다.");
      await purgePlanting(
        db,
        meta.epoch,
        meta.activeGenerationId,
        id,
        expectedRevision
      );
      await loadData();
    },
    [db, meta, loadData]
  );

  const startNewCycle = useCallback(
    async (plantingId: string, startLocalDate: string) => {
      if (!meta) throw new Error("데이터베이스가 초기화되지 않았습니다.");
      const res = await startCycleAction(
        db,
        meta.epoch,
        meta.activeGenerationId,
        {
          plantingId,
          startLocalDate,
        }
      );
      await loadData();
      return res;
    },
    [db, meta, loadData]
  );

  const finishCycle = useCallback(
    async (
      cycleId: string,
      endLocalDate: string,
      expectedRevision?: number
    ) => {
      if (!meta) throw new Error("데이터베이스가 초기화되지 않았습니다.");
      const res = await endCycleAction(
        db,
        meta.epoch,
        meta.activeGenerationId,
        {
          cycleId,
          endLocalDate,
          expectedRevision,
        }
      );
      await loadData();
      return res;
    },
    [db, meta, loadData]
  );

  const getActiveCycleForPlanting = useCallback(
    async (plantingId: string) => {
      if (!meta) return undefined;
      return await getActiveCycleAction(db, meta.activeGenerationId, plantingId);
    },
    [db, meta]
  );

  const getCyclesForPlanting = useCallback(
    async (plantingId: string) => {
      if (!meta) return [];
      return await listCyclesByPlantingAction(
        db,
        meta.activeGenerationId,
        plantingId,
        { includeTrashed: true }
      );
    },
    [db, meta]
  );

  const setWriteFenceState = useCallback(
    async (active: boolean) => {
      await setWriteFenceAction(db, active);
      await loadData();
    },
    [db, loadData]
  );

  const value: DbContextValue = {
    isReady,
    error,
    db,
    meta,
    locations,
    trashedLocations,
    plantings,
    trashedPlantings,
    refresh: loadData,
    addLocation,
    editLocation,
    removeLocation,
    restoreLocationItem,
    purgeLocationItem,
    addPlanting,
    editPlanting,
    movePlanting,
    splitPlanting,
    changeQuantity,
    removePlanting,
    restorePlantingItem,
    purgePlantingItem,
    startNewCycle,
    finishCycle,
    getActiveCycleForPlanting,
    getCyclesForPlanting,
    setWriteFenceState,
  };

  return <DbContext.Provider value={value}>{children}</DbContext.Provider>;
}

export function useDb(): DbContextValue {
  const ctx = useContext(DbContext);
  if (!ctx) {
    throw new Error("useDb must be used within a DbProvider");
  }
  return ctx;
}

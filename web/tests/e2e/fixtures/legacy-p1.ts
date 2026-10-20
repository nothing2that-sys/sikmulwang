//+_+// Test-only bridge bundles the actual frozen P1 code; never imported by the product application.
import { SikmulwangDB, initializeDatabase } from "../../../src/test/fixtures/p1-8aebf378/database";
import { createPlanting, purgePlanting, updatePlanting } from "../../../src/test/fixtures/p1-8aebf378/plantingRepository";

let db = new SikmulwangDB();
let epoch = 1;
let generation = "g_default";
const bridge = {
  async initialize() {
    const meta = await initializeDatabase(db);
    epoch = meta.epoch; generation = meta.activeGenerationId;
    return meta;
  },
  seed() {
    return createPlanting(db, epoch, generation, { displayName: "구 P1 브라우저 식물", locationId: "loc_indoor_living", groupType: "INDIVIDUAL", quantity: 1, startLocalDate: "2026-01-01" });
  },
  purge(id: string, revision: number) { return purgePlanting(db, epoch, generation, id, revision); },
  edit(id: string, revision: number) { return updatePlanting(db, epoch, generation, id, { displayName: "구 탭 변경", expectedRevision: revision }); },
  isOpen() { return db.isOpen(); },
  reopen() { db.close(); db = new SikmulwangDB(); return bridge.initialize(); },
  async dump() {
    const stores: Record<string, unknown[]> = {};
    for (const table of db.tables) stores[table.name] = await table.toArray();
    return stores;
  },
};
declare global { interface Window { legacyP1: typeof bridge } }
window.legacyP1 = bridge;

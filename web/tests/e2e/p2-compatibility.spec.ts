import { test, expect, type Page } from "@playwright/test";
import { build } from "vite";
import { resolve } from "node:path";

test.use({ serviceWorkers: "block" });
let legacyBundle: string;
test.beforeAll(async () => {
  const built = await build({
    configFile: false, logLevel: "silent",
    build: { write: false, minify: false, target: "es2022", lib: { entry: resolve("tests/e2e/fixtures/legacy-p1.ts"), name: "LegacyP1", formats: ["iife"] } },
  });
  const output = Array.isArray(built) ? built[0] : built;
  if (!("output" in output)) throw new Error("Expected an in-memory test bundle");
  legacyBundle = output.output.filter(chunk => chunk.type === "chunk").map(chunk => chunk.code).join("\n");
});
async function openP1(page: Page) {
  await page.route("**/__p1_test/index.html", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: "<!doctype html><meta charset=utf-8><title>Isolated P1 test</title><main>Isolated P1 test</main>" }));
  await page.route("**/__p1_test/legacy.js", route => route.fulfill({ contentType: "text/javascript; charset=utf-8", body: legacyBundle }));
  await page.goto("/__p1_test/index.html");
  await page.addScriptTag({ url: "/__p1_test/legacy.js" });
}
async function errorName(action: () => Promise<unknown>) {
  try { await action(); return "UNEXPECTED_SUCCESS"; }
  catch (error) { return String(error); }
}

test("R1 actual Chromium kept-open and reopened P1 refuse writes/application initialization", async ({ page: old, context }) => {
  await openP1(old);
  await old.evaluate(() => window.legacyP1.initialize());
  const seeded = await old.evaluate(() => window.legacyP1.seed());
  const app = await context.newPage(); await app.goto("/");
  await app.getByRole("button", { name: "사용자 확인 간격 설정" }).click();
  await app.getByRole("button", { name: "확인하고 저장" }).click();
  await expect(app.getByRole("dialog")).toHaveCount(0);
  await app.getByRole("button", { name: "물 줬어요", exact: true }).click();
  await app.getByRole("button", { name: "확인하고 저장" }).click();
  await expect(app.getByRole("dialog")).toHaveCount(0);
  const before = await old.evaluate(() => window.legacyP1.dump());
  expect(await old.evaluate(() => window.legacyP1.isOpen())).toBe(true);
  expect(await errorName(() => old.evaluate(p => window.legacyP1.purge(p.id, p.revision), seeded.planting))).toContain("지원하지 않는 스키마");
  expect(await errorName(() => old.evaluate(p => window.legacyP1.edit(p.id, p.revision), seeded.planting))).toContain("지원하지 않는 스키마");
  expect(await errorName(() => old.evaluate(() => window.legacyP1.reopen()))).toContain("지원하지 않는 스키마");
  const reopened = await context.newPage(); await openP1(reopened);
  expect(await errorName(() => reopened.evaluate(() => window.legacyP1.initialize()))).toContain("지원하지 않는 스키마");
  expect(await errorName(() => reopened.evaluate(p => window.legacyP1.purge(p.id, p.revision), seeded.planting))).toContain("지원하지 않는 스키마");
  expect(await old.evaluate(() => window.legacyP1.dump())).toEqual(before);
  expect(before.careEvents).toHaveLength(1); expect(before.taskOccurrences).toHaveLength(2);
  const logs = before.decisionLogs as Array<{ outputSnapshot: string; ruleSnapshotIds: string[] }>;
  const snapshots = before.ruleSnapshots as Array<{ id: string }>;
  for (const log of logs) {
    const id = JSON.parse(log.outputSnapshot).evidence.ruleSnapshotId;
    expect(id).toBe(log.ruleSnapshotIds[0]); expect(snapshots.some(snapshot => snapshot.id === id)).toBe(true);
  }
});

test("R1 native IndexedDB mid-transition quota failure preserves P1 data and reload recovers", async ({ page: old, context }) => {
  await openP1(old); await old.evaluate(() => window.legacyP1.initialize()); await old.evaluate(() => window.legacyP1.seed());
  const before = await old.evaluate(() => window.legacyP1.dump());
  const app = await context.newPage();
  await app.addInitScript(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, ...keys) {
      if (this.name === "meta" && value.key === "schemaVersion" && value.value === 3 && !sessionStorage.getItem("transition-fault-used")) {
        sessionStorage.setItem("transition-fault-used", "yes");
        throw new DOMException("Injected transition quota failure", "QuotaExceededError");
      }
      return Reflect.apply(original, this, [value, ...keys]);
    };
  });
  await app.goto("/plants");
  await expect(app.getByRole("heading", { name: "데이터베이스 접근 오류" })).toBeVisible();
  expect(await old.evaluate(() => window.legacyP1.dump())).toEqual(before);
  expect(await old.evaluate(() => window.legacyP1.initialize())).toMatchObject({ schemaVersion: 1, epoch: 1 });
  await app.reload();
  await expect(app.getByRole("heading", { name: "구 P1 브라우저 식물", exact: true })).toBeVisible();
  const after = await old.evaluate(() => window.legacyP1.dump());
  expect(after.plantings).toEqual(before.plantings); expect(after.cycles).toEqual(before.cycles);
  expect(after.meta).toContainEqual(expect.objectContaining({ key: "schemaVersion", value: 3 }));
  expect(after.meta).toContainEqual(expect.objectContaining({ key: "epoch", value: 2 }));
  expect(await errorName(() => old.evaluate(() => window.legacyP1.initialize()))).toContain("지원하지 않는 스키마");
});

test("R2 native snapshot body corruption keeps care unsaved, restores trusted bytes and retries once", async ({ page: old, context }) => {
  await openP1(old); await old.evaluate(() => window.legacyP1.initialize()); await old.evaluate(() => window.legacyP1.seed());
  const app = await context.newPage(); await app.goto("/");
  await app.getByRole("button", { name: "사용자 확인 간격 설정" }).click();
  await app.getByRole("button", { name: "확인하고 저장" }).click(); await expect(app.getByRole("dialog")).toHaveCount(0);
  const before = await old.evaluate(() => window.legacyP1.dump());
  const original = before.ruleSnapshots[0] as { generationId: string; id: string; normalizedBody: string };
  async function replaceBody(normalizedBody: string) {
    await old.evaluate(({ key, body }) => new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("sikmulwang-db");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction("ruleSnapshots", "readwrite"), store = tx.objectStore("ruleSnapshots");
        const read = store.get(key);
        read.onsuccess = () => store.put({ ...read.result, normalizedBody: body });
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(tx.error); };
      };
    }), { key: [original.generationId, original.id], body: normalizedBody });
  }
  await replaceBody('{"inspectionDays":30,"tampered":true}');
  const damaged = await old.evaluate(() => window.legacyP1.dump());
  await app.getByRole("button", { name: "물 줬어요", exact: true }).click();
  await app.getByRole("button", { name: "확인하고 저장" }).click();
  await expect(app.getByRole("dialog").getByRole("alert")).toContainText("SHA-256");
  expect(await old.evaluate(() => window.legacyP1.dump())).toEqual(damaged);
  await replaceBody(original.normalizedBody);
  await app.getByRole("button", { name: "다시 시도", exact: true }).click(); await expect(app.getByRole("dialog")).toHaveCount(0);
  const after = await old.evaluate(() => window.legacyP1.dump());
  expect(after.careEvents).toHaveLength(1); expect(after.decisionLogs).toHaveLength(2);
});

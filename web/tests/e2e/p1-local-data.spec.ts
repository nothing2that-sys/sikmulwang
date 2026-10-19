//+_+// Playwright E2E tests for Phase 1 local data foundation
import { test, expect } from "@playwright/test";

test.describe("P1 Local Data Foundation — UI & Persistence", () => {
  test("registers plant, displays it in list, and persists across reload", async ({
    page,
  }) => {
    await page.goto("/plants");

    //+_+// Initial empty state
    await expect(page.getByText("아직 함께하는 식물이 없어요")).toBeVisible();

    //+_+// Click button to open add modal
    await page.getByRole("button", { name: "새 식물 심기" }).click();
    await expect(
      page.getByRole("heading", { name: "새 식물 심기" })
    ).toBeVisible();

    //+_+// Fill plant details
    await page
      .getByLabel("식물 이름 (애칭 또는 품종) *")
      .fill("내 사랑 몬스테라");
    await page.getByLabel("재배 장소 *").selectOption({ label: "거실 창가 (실내)" });

    //+_+// Submit form
    await page.getByRole("button", { name: "식물 등록 완료" }).click();

    //+_+// Verify plant appears in active list
    await expect(
      page.getByRole("heading", { name: "내 사랑 몬스테라" })
    ).toBeVisible();
    await expect(
      page.locator(".plant-card").getByText("거실 창가 (실내)")
    ).toBeVisible();
    await expect(page.getByText("개체 · 1그루")).toBeVisible();

    //+_+// Reload page and verify persistence
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "내 사랑 몬스테라" })
    ).toBeVisible();
    await expect(
      page.locator(".plant-card").getByText("거실 창가 (실내)")
    ).toBeVisible();
  });

  test("manages plant location move, quantity change, and group split", async ({
    page,
  }) => {
    await page.goto("/plants");

    //+_+// Register a group planting
    await page.getByRole("button", { name: "새 식물 심기" }).click();
    await page
      .getByLabel("식물 이름 (애칭 또는 품종) *")
      .fill("방울토마토 모종 5포기");
    await page.getByLabel("관리 형태").selectOption("GROUP");
    await page.getByLabel("수량 *").fill("5");
    await page.getByLabel("단위").fill("포기");
    await page
      .getByLabel("재배 장소 *")
      .selectOption({ label: "거실 창가 (실내)" });
    await page.getByRole("button", { name: "식물 등록 완료" }).click();

    await expect(
      page.getByRole("heading", { name: "방울토마토 모종 5포기" })
    ).toBeVisible();
    await expect(page.getByText("그룹 · 5포기")).toBeVisible();

    //+_+// Open plant management modal
    await page.getByRole("button", { name: "관리하기" }).click();
    await expect(
      page.getByRole("heading", { name: "방울토마토 모종 5포기 관리" })
    ).toBeVisible();

    //+_+// 1. Move location
    await page
      .getByLabel("이동할 장소 선택")
      .selectOption({ label: "베란다 정원 (베란다)" });
    await page.getByRole("button", { name: "장소 이동 실행" }).click();
    await expect(page.getByText("장소를 성공적으로 이동했습니다.")).toBeVisible();

    //+_+// 2. Change quantity with reason
    await page.getByLabel("수량 변경값").fill("4");
    await page.getByLabel("수량 변경 사유").fill("1포기 분갈이 분리");
    await page.getByRole("button", { name: "수량 변경 저장" }).click();
    await expect(page.getByText("수량이 성공적으로 변경되었습니다.")).toBeVisible();

    //+_+// Close modal and verify card reflects updates
    await page.getByRole("button", { name: "닫기" }).click();
    await expect(
      page.locator(".plant-card").getByText("베란다 정원 (베란다)")
    ).toBeVisible();
    await expect(page.getByText("그룹 · 4포기")).toBeVisible();
    await expect(page.getByText("1포기 분갈이 분리")).toBeVisible();
  });

  test("trashes plant, shows it in settings trash, and restores it", async ({
    page,
  }) => {
    await page.goto("/plants");

    //+_+// Register a plant to trash
    await page.getByRole("button", { name: "새 식물 심기" }).click();
    await page.getByLabel("식물 이름 (애칭 또는 품종) *").fill("휴지통 테스트 화분");
    await page.getByRole("button", { name: "식물 등록 완료" }).click();

    await expect(
      page.getByRole("heading", { name: "휴지통 테스트 화분", exact: true })
    ).toBeVisible();

    //+_+// Open management and delete (trash)
    await page.getByRole("button", { name: "관리하기" }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "휴지통으로 이동" }).click();

    //+_+// Verify plant is removed from active list
    await expect(
      page.getByRole("heading", { name: "휴지통 테스트 화분", exact: true })
    ).not.toBeVisible();

    //+_+// Navigate to Settings page
    await page.goto("/settings");
    await expect(
      page.getByRole("heading", { name: "휴지통 관리" })
    ).toBeVisible();
    await expect(page.getByText("휴지통 테스트 화분")).toBeVisible();

    //+_+// Click Restore
    await page.getByRole("button", { name: "복원" }).click();
    await expect(page.getByText("휴지통이 비어 있어요.")).toBeVisible();

    //+_+// Navigate back to Plants and verify restoration
    await page.goto("/plants");
    await expect(
      page.getByRole("heading", { name: "휴지통 테스트 화분", exact: true })
    ).toBeVisible();
  });

  test("persists plant creation and reads data while offline", async ({
    page,
    context,
  }) => {
    await page.goto("/plants");

    //+_+// Wait for service worker to be ready so offline navigation works
    await page.evaluate(async () => {
      await navigator.serviceWorker?.ready;
    });
    await expect
      .poll(() => page.evaluate(() => !!navigator.serviceWorker?.controller))
      .toBe(true);

    //+_+// Go offline
    await context.setOffline(true);

    //+_+// Register plant offline
    await page.getByRole("button", { name: "새 식물 심기" }).click();
    await page.getByLabel("식물 이름 (애칭 또는 품종) *").fill("오프라인 바질");
    await page.getByRole("button", { name: "식물 등록 완료" }).click();

    //+_+// Verify displayed while offline
    await expect(
      page.getByRole("heading", { name: "오프라인 바질", exact: true })
    ).toBeVisible();

    //+_+// Reload page while offline
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "오프라인 바질", exact: true })
    ).toBeVisible();

    //+_+// Restore online state
    await context.setOffline(false);
  });
});

//+_+// Playwright E2E tests for Phase 1 local data foundation
import { test, expect } from "@playwright/test";

for (const width of [320, 360, 390, 768, 1280]) {
  test(`plant dialogs stay above navigation and scroll at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 640 });
    await page.goto("/plants");
    const trigger = page.getByRole("button", { name: "새 식물 심기", exact: true });
    await trigger.click();
    const addDialog = page.getByRole("dialog", { name: "새 식물 심기", exact: true });
    await expect(addDialog).toBeVisible();
    expect(await addDialog.evaluate((el) => el.matches(":modal"))).toBe(true);
    await page.getByLabel("식물 이름 (애칭 또는 품종) *").fill("모바일 등록 검증");
    await page.getByLabel("관리 형태").selectOption("GROUP");
    await page.getByLabel("수량 *").fill("3");
    expect(await addDialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect((await addDialog.boundingBox())!.height).toBeLessThanOrEqual(640);
    await page.getByRole("button", { name: "식물 등록 완료" }).click();
    await expect(addDialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(page.getByRole("heading", { name: "모바일 등록 검증", exact: true })).toBeVisible();

    const manageTrigger = page.getByRole("button", { name: "관리하기" });
    await manageTrigger.click();
    const manageDialog = page.getByRole("dialog", { name: "모바일 등록 검증 관리" });
    await expect(manageDialog).toBeVisible();
    expect(await manageDialog.evaluate((el) => el.matches(":modal"))).toBe(true);
    expect(await manageDialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect((await manageDialog.boundingBox())!.height).toBeLessThanOrEqual(640);
    await page.getByRole("button", { name: "닫기", exact: true }).click();
    await expect(manageTrigger).toBeFocused();

    await manageTrigger.click();
    for (let i = 0; i < 18; i += 1) {
      await page.keyboard.press("Tab");
      expect(await manageDialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(manageDialog).toHaveCount(0);
    await expect(manageTrigger).toBeFocused();
  });
}

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

  test("handles multi-tab concurrency conflict and allows conflict recovery", async ({
    page,
    context,
  }) => {
    //+_+// Open Tab 1 and register a plant
    await page.goto("/plants");
    await page.getByRole("button", { name: "새 식물 심기" }).click();
    await page.getByLabel("식물 이름 (애칭 또는 품종) *").fill("동시성 테스트 바질");
    await page.getByRole("button", { name: "식물 등록 완료" }).click();

    await expect(
      page.getByRole("heading", { name: "동시성 테스트 바질", exact: true })
    ).toBeVisible();

    //+_+// Open Tab 2 with same context
    const page2 = await context.newPage();
    await page2.goto("/plants");
    await expect(
      page2.getByRole("heading", { name: "동시성 테스트 바질", exact: true })
    ).toBeVisible();

    //+_+// Open manage modal on Tab 1
    await page.getByRole("button", { name: "관리하기" }).click();
    await expect(
      page.getByRole("heading", { name: "동시성 테스트 바질 관리" })
    ).toBeVisible();

    //+_+// Open manage modal on Tab 2
    await page2.getByRole("button", { name: "관리하기" }).click();
    await expect(
      page2.getByRole("heading", { name: "동시성 테스트 바질 관리" })
    ).toBeVisible();

    //+_+// On Tab 1: edit basic info and save (advancing revision from 1 to 2)
    await page.getByLabel("식물 이름").fill("동시성 바질 (수정됨)");
    await page.getByRole("button", { name: "기본 정보 저장" }).click();
    await expect(page.getByText("기본 정보를 성공적으로 수정했습니다.")).toBeVisible();

    //+_+// On Tab 2: try to edit basic info with stale revision 1
    await page2.getByLabel("식물 이름").fill("동시성 바질 충돌 시도");
    await page2.getByRole("button", { name: "기본 정보 저장" }).click();

    //+_+// Tab 2 receives optimistic concurrency conflict error
    await expect(page2.getByRole("alert")).toContainText("식물 수정 충돌");
    await expect(
      page2.getByRole("button", { name: "최신 정보 확인 및 다시 불러오기" })
    ).toBeVisible();

    //+_+// Tab 2 clicks refresh button to reload latest version (rev 2)
    await page2.getByRole("button", { name: "최신 정보 확인 및 다시 불러오기" }).click();
    await expect(page2.getByText("버전(Rev): 2")).toBeVisible();

    //+_+// R1 fix verification: Tab 2's uncommitted draft MUST be preserved
    await expect(page2.getByLabel("식물 이름")).toHaveValue("동시성 바질 충돌 시도");
    await expect(page2.getByText("저장소 현재 이름: 동시성 바질 (수정됨)")).toBeVisible();

    //+_+// Tab 2 now saves immediately without re-typing, applying draft to rev 2 -> 3
    await page2.getByRole("button", { name: "기본 정보 저장" }).click();
    await expect(
      page2.getByText("기본 정보를 성공적으로 수정했습니다.")
    ).toBeVisible();
    await expect(page2.getByText("버전(Rev): 3")).toBeVisible();

    await page2.close();
  });

  test("manages custom locations and blocks deletion when referenced by plants", async ({
    page,
  }) => {
    await page.goto("/plants");

    //+_+// Open Location Management dialog
    await page.getByRole("button", { name: "재배 장소 관리" }).click();
    const locDialog = page.getByRole("dialog", { name: "재배 장소 관리" });
    await expect(locDialog).toBeVisible();

    //+_+// Click Add Location
    await page.getByRole("button", { name: "새 장소 추가" }).click();
    await expect(
      page.getByRole("heading", { name: "새 재배 장소 등록" })
    ).toBeVisible();

    //+_+// Fill custom location
    await page.getByLabel("장소 이름 *").fill("옥상 정원 테스트");
    await page.getByLabel("공간 환경 유형").selectOption("OUTDOOR");
    await page.getByRole("button", { name: "장소 저장" }).click();

    //+_+// Verify location is listed
    await expect(
      locDialog.getByRole("strong").filter({ hasText: "옥상 정원 테스트" })
    ).toBeVisible();

    //+_+// Close Location dialog
    await page.getByRole("button", { name: "닫기" }).click();

    //+_+// Register a plant at this new location
    await page.getByRole("button", { name: "새 식물 심기" }).click();
    await page.getByLabel("식물 이름 (애칭 또는 품종) *").fill("옥상 로즈마리");
    await page
      .getByLabel("재배 장소 *")
      .selectOption({ label: "옥상 정원 테스트" });
    await page.getByRole("button", { name: "식물 등록 완료" }).click();

    await expect(
      page.getByRole("heading", { name: "옥상 로즈마리", exact: true })
    ).toBeVisible();
    await expect(
      page.locator(".plant-card").getByText("옥상 정원 테스트")
    ).toBeVisible();

    //+_+// Try to delete the location that is in use
    await page.getByRole("button", { name: "재배 장소 관리" }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await locDialog.getByLabel("옥상 정원 테스트 삭제").click();

    //+_+// Verify deletion is blocked with reference error
    await expect(
      locDialog.getByRole("alert")
    ).toContainText("사용 중인 식물");

    //+_+// Verify location is still present
    await expect(
      locDialog.getByRole("strong").filter({ hasText: "옥상 정원 테스트" })
    ).toBeVisible();
  });
});

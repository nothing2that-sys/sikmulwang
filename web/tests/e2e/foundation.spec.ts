import { test, expect, chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("offline shell survives browser process restart", async () => {
  const profile = mkdtempSync(join(tmpdir(), "sikmulwang-p0-"));
  const options = {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    headless: true,
  };
  let context = await chromium.launchPersistentContext(profile, options);
  try {
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:4173/discover");
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await context.close();
    context = await chromium.launchPersistentContext(profile, options);
    await context.setOffline(true);
    const reopened = await context.newPage();
    await reopened.goto("http://127.0.0.1:4173/journal");
    await expect(reopened.getByRole("heading", { level: 1 })).toHaveText("일기장");
    await expect(reopened.getByText("오프라인 · 기본 화면을 이용할 수 있어요")).toBeVisible();
  } finally {
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  }
});

test("home and four routes keep location on refresh", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "오늘도, 초록과 함께",
  );
  for (const [label, path] of [
    ["식물 찾기", "/discover"],
    ["내 식물", "/plants"],
    ["일기장", "/journal"],
    ["오늘", "/"],
  ]) {
    await page
      .getByRole("navigation", { name: "주 메뉴" })
      .getByRole("link", { name: label, exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(
      page
        .getByRole("navigation")
        .getByRole("link", { name: label, exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
  }
});

for (const width of [320, 360, 390, 768, 1280]) {
  test(`responsive routes, touch targets and keyboard focus at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const path of [
      "/",
      "/discover",
      "/plants",
      "/journal",
      "/journal/new",
      "/settings",
      "/plants/preview",
      "/discover/demo-basil",
      "/week",
      "/check",
      "/bad-url",
    ]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    }
    const nav = await page.getByRole("navigation").boundingBox();
    expect(nav).not.toBeNull();
    if (width < 768) expect(nav!.y).toBeGreaterThan(750);
    else expect(nav!.y).toBeLessThan(150);
    for (const link of await page
      .getByRole("navigation")
      .getByRole("link")
      .all()) {
      const rect = await link.boundingBox();
      expect(rect!.height).toBeGreaterThanOrEqual(44);
      expect(rect!.width).toBeGreaterThanOrEqual(44);
    }
    await page.goto("/journal/new");
    await page.getByLabel("제목 (선택)").fill("키보드 미리보기");
    await page.getByRole("button", { name: "미리보기 입력 비우기" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "미리보기 입력을 비울까요?" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "취소", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "입력 비우기", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "취소", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: "미리보기 입력 비우기" }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    const focused = await page.locator(":focus").boundingBox();
    if (width < 768)
      expect(focused!.y + focused!.height).toBeLessThanOrEqual(nav!.y);
    await page.screenshot({
      path: `test-results/screenshots/journal-${width}.png`,
      fullPage: true,
    });
  });
}

test("full keyboard navigation and visible focus", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "본문으로 건너뛰기" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "식물 찾기", exact: true })
    .focus();
  const outline = await page
    .locator(":focus")
    .evaluate((element) => getComputedStyle(element).outlineStyle);
  expect(outline).toBe("solid");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { level: 1, name: "식물 찾기" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("searchbox")).toBeFocused();
  await page.keyboard.type("바질");
  await expect(page.getByText("1종", { exact: true })).toBeVisible();
});

test("catalog, calendar, disabled planned actions and 404", async ({
  page,
}) => {
  await page.goto("/discover");
  await page.getByLabel("재배 장소").selectOption("야외");
  await page.getByLabel("계절").selectOption("봄");
  await expect(
    page.getByRole("heading", { name: "상추", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("계절")).toHaveValue("봄");
  await page.getByRole("link", { name: "상추 상세정보" }).click();
  await expect(
    page.getByRole("button", { name: "내 식물 등록 준비 중" }),
  ).toBeDisabled();
  await page.goto("/journal");
  await page.getByRole("button", { name: "달력", exact: true }).click();
  await expect(page.getByRole("table")).toBeVisible();
  const first = await page.locator(".calendar-heading h2").textContent();
  await page.getByRole("button", { name: "다음 달" }).click();
  expect(await page.locator(".calendar-heading h2").textContent()).not.toEqual(
    first,
  );
  await page.goto("/this-does-not-exist");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "페이지를 찾을 수 없어요",
  );
});

test("WCAG AA automated checks on main and secondary screens", async ({
  page,
}) => {
  for (const path of [
    "/",
    "/discover",
    "/plants",
    "/journal",
    "/journal/new",
    "/settings",
    "/plants/preview",
    "/discover/demo-monstera",
    "/week",
    "/check",
    "/not-found",
  ]) {
    await page.goto(path);
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(result.violations).toEqual([]);
  }
  await page.goto("/");
  await page.getByRole("checkbox", { name: "개발용 관리 카드 보기" }).check();
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2aa", "wcag22aa"]).analyze())
      .violations,
  ).toEqual([]);
});

test("200 percent text and reduced motion reflow", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const path of ["/", "/discover", "/journal/new", "/settings"]) {
    await page.goto(path);
    await page.addStyleTag({ content: "html { font-size: 200%; }" });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }
});

test("manifest, cold offline shell and static-only cache", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  const manifest = await (
    await context.request.get("/manifest.webmanifest")
  ).json();
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons).toHaveLength(3);
  await page.goto("/journal/new");
  await page.getByLabel("일기 내용").fill("임시 테스트 문구");
  await page.evaluate(async () => {
    await caches
      .open("unrelated-cache")
      .then((cache) =>
        cache.put("/private-sentinel", new Response("preserve")),
      );
    await fetch("/api/not-implemented").catch(() => {});
  });
  await page.close();
  await context.setOffline(true);
  const offlinePage = await context.newPage();
  await offlinePage.goto("/discover");
  await expect(offlinePage.getByRole("heading", { level: 1 })).toHaveText(
    "식물 찾기",
  );
  await expect(
    offlinePage.getByText("오프라인 · 기본 화면을 이용할 수 있어요"),
  ).toBeVisible();
  await offlinePage
    .getByRole("navigation")
    .getByRole("link", { name: "일기장", exact: true })
    .click();
  await offlinePage.reload();
  await expect(offlinePage.getByRole("heading", { level: 1 })).toHaveText(
    "일기장",
  );
  await offlinePage.goto("/journal/new");
  await expect(offlinePage.getByLabel("일기 내용")).toHaveValue("");
  const keys = await offlinePage.evaluate(async () => {
    const names = await caches.keys();
    const shell = names.find((name) => name.startsWith("sikmulwang-shell-"))!;
    return (await (await caches.open(shell)).keys()).map(
      (request) => new URL(request.url).pathname,
    );
  });
  expect(keys.some((key) => key.startsWith("/api/"))).toBe(false);
  expect(
    keys.every(
      (key) =>
        key === "/" ||
        key === "/index.html" ||
        key === "/manifest.webmanifest" ||
        key.startsWith("/assets/") ||
        key.startsWith("/icons/"),
    ),
  ).toBe(true);
  expect(
    await offlinePage.evaluate(async () =>
      (await caches.open("unrelated-cache"))
        .match("/private-sentinel")
        .then((response) => response?.text()),
    ),
  ).toBe("preserve");
  await context.setOffline(false);
  await expect(offlinePage.getByText("온라인", { exact: true })).toBeVisible();
});

test("SW update waits for user and preserves unrelated caches", async ({
  page,
}) => {
  const file = "dist/sw.js";
  const original = readFileSync(file, "utf8");
  try {
    await page.goto("/settings");
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await expect
      .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
      .toBe(true);
    await page.evaluate(async () => {
      await caches
        .open("keep-me")
        .then((cache) => cache.put("/marker", new Response("safe")));
    });
    writeFileSync(
      file,
      original.replace(
        /sikmulwang-shell-([a-f0-9]+)/,
        "sikmulwang-shell-testupdate",
      ),
    );
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration?.update();
    });
    await expect(
      page.getByRole("button", { name: "업데이트 안내" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "업데이트 안내" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "취소", exact: true }).click();
    expect(
      await page.evaluate(
        async () =>
          !!(await navigator.serviceWorker.getRegistration())?.waiting,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "업데이트 안내" }).click();
    await Promise.all([
      page.waitForEvent("framenavigated", (frame) => frame === page.mainFrame()),
      page.getByRole("button", { name: "업데이트하고 새로고침" }).click(),
    ]);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "설정 및 데이터 관리",
    );
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            !!(await navigator.serviceWorker.getRegistration())?.waiting,
        ),
      )
      .toBe(false);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "설정 및 데이터 관리",
    );
    expect(
      await page.evaluate(async () =>
        (await caches.open("keep-me"))
          .match("/marker")
          .then((response) => response?.text()),
      ),
    ).toBe("safe");
  } finally {
    writeFileSync(file, original);
  }
});

test("desktop and mobile visual evidence", async ({ page }) => {
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [name, path] of [
      ["today", "/"],
      ["discover", "/discover"],
      ["plants", "/plants"],
      ["journal", "/journal"],
      ["settings", "/settings"],
    ]) {
      await page.goto(path);
      await page.screenshot({
        path: `test-results/screenshots/${name}-${width}.png`,
        fullPage: true,
      });
    }
  }
});

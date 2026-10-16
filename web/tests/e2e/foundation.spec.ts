import { test, expect, chromium, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function assertInteractiveTouchTargets(page: Page) {
  const selector = [
    "button",
    "a:not(.skip-link)",
    'input:not([type="checkbox"])',
    "select",
    "textarea",
    "summary",
    ".demo-toggle",
    ".tag-options label",
  ].join(", ");
  const elements = page.locator(selector);
  const count = await elements.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i += 1) {
    const item = elements.nth(i);
    if (!(await item.isVisible())) continue;
    const rect = await item.boundingBox();
    expect(rect).not.toBeNull();
    expect(rect!.width).toBeGreaterThanOrEqual(44);
    expect(rect!.height).toBeGreaterThanOrEqual(44);
  }
}

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
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await expect
      .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
      .toBe(true);
    await context.close();
    context = await chromium.launchPersistentContext(profile, options);
    await context.setOffline(true);
    const reopened = await context.newPage();
    await reopened.goto("http://127.0.0.1:4173/journal");
    await expect(reopened.getByRole("heading", { level: 1 })).toHaveText(
      "일기장",
    );
    await expect(
      reopened.getByText("오프라인 · 기본 화면을 이용할 수 있어요"),
    ).toBeVisible();
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
      await assertInteractiveTouchTargets(page);
    }
    await page.goto("/");
    await page.getByRole("checkbox", { name: "개발용 관리 카드 보기" }).check();
    await page
      .getByRole("button", { name: "데모 작업 모두 보기 (4개)" })
      .click();
    await assertInteractiveTouchTargets(page);

    await page.goto("/plants");
    for (const summary of await page.locator("summary").all()) {
      await summary.click();
    }
    await assertInteractiveTouchTargets(page);

    await page.goto("/journal");
    await page.getByRole("button", { name: "달력", exact: true }).click();
    await assertInteractiveTouchTargets(page);

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
    await assertInteractiveTouchTargets(page);
    await page.getByLabel("제목 (선택)").fill("키보드 미리보기");
    await page.getByRole("button", { name: "미리보기 입력 비우기" }).focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("dialog", { name: "미리보기 입력을 비울까요?" }),
    ).toBeVisible();
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
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `test-results/screenshots/journal-${width}.png`,
      fullPage: false,
    });
    await page.screenshot({
      path: `test-results/screenshots/journal-${width}-full.png`,
      fullPage: true,
    });
  });
}

test("full keyboard navigation, skip link clipping and visible focus", async ({
  page,
}) => {
  await page.goto("/");
  const skipLink = page.getByRole("link", { name: "본문으로 건너뛰기" });

  //+_+// Verify unfocused skip link stays visually hidden at top and when scrolled
  const checkSkipLinkHidden = async () => {
    const state = await skipLink.evaluate((el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        display: style.display,
        visibility: style.visibility,
        ariaHidden: el.getAttribute("aria-hidden"),
        clipPath: style.clipPath,
        overflow: style.overflow,
        width: rect.width,
        height: rect.height,
      };
    });
    expect(state.display).not.toBe("none");
    expect(state.visibility).not.toBe("hidden");
    expect(state.ariaHidden).toBeNull();
    expect(state.clipPath).toBe("inset(50%)");
    expect(state.overflow).toBe("hidden");
    expect(state.width).toBeLessThanOrEqual(1);
    expect(state.height).toBeLessThanOrEqual(1);
  };

  await checkSkipLinkHidden();
  await page.evaluate(() => window.scrollTo(0, 250));
  await checkSkipLinkHidden();
  await page.evaluate(() => window.scrollTo(0, 0));

  await page.keyboard.press("Tab");
  await expect(skipLink).toBeFocused();
  const focusedSkipState = await skipLink.evaluate((el) => {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return {
      clipPath: style.clipPath,
      outlineStyle: style.outlineStyle,
      width: rect.width,
      height: rect.height,
    };
  });
  expect(focusedSkipState.clipPath).toBe("none");
  expect(focusedSkipState.outlineStyle).toBe("solid");
  expect(focusedSkipState.width).toBeGreaterThanOrEqual(44);
  expect(focusedSkipState.height).toBeGreaterThanOrEqual(44);

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
  const heading = page.getByRole("heading", { level: 1, name: "식물 찾기" });
  await expect(heading).toBeFocused();
  const headingOutline = await heading.evaluate((element) => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: style.outlineWidth };
  });
  expect(headingOutline.style).toBe("solid");
  expect(headingOutline.width).not.toBe("0px");

  await page.keyboard.press("Tab");
  await expect(page.getByRole("searchbox")).toBeFocused();
  await page.keyboard.type("바질");
  await expect(page.getByText("1종", { exact: true })).toBeVisible();
});

test("catalog search and filter URL state, detail return, history, calendar and 404", async ({
  page,
}) => {
  await page.goto("/discover");
  await page.getByRole("searchbox").fill("바질");
  await page.getByLabel("식물 유형").selectOption("허브");
  await page.getByLabel("재배 장소").selectOption("베란다");
  await page.getByLabel("계절").selectOption("여름");

  const expectedQuery =
    "?q=%EB%B0%94%EC%A7%88&category=%ED%97%88%EB%B8%8C&place=%EB%B2%A0%EB%9E%80%EB%8B%A4&season=%EC%97%AC%EB%A6%84";
  await expect(page).toHaveURL(
    `http://127.0.0.1:4173/discover${expectedQuery}`,
  );
  await expect(page.getByText("1종", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "바질", exact: true }),
  ).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(
    `http://127.0.0.1:4173/discover${expectedQuery}`,
  );
  await expect(page.getByRole("searchbox")).toHaveValue("바질");
  await expect(page.getByLabel("식물 유형")).toHaveValue("허브");
  await expect(page.getByLabel("재배 장소")).toHaveValue("베란다");
  await expect(page.getByLabel("계절")).toHaveValue("여름");
  await expect(page.getByText("1종", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "바질 상세정보" }).click();
  await expect(page).toHaveURL(
    `http://127.0.0.1:4173/discover/demo-basil${expectedQuery}`,
  );
  await expect(
    page.getByRole("heading", { level: 1, name: "바질" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "내 식물 등록 준비 중" }),
  ).toBeDisabled();

  await page.reload();
  await expect(page).toHaveURL(
    `http://127.0.0.1:4173/discover/demo-basil${expectedQuery}`,
  );
  await expect(
    page.getByRole("heading", { level: 1, name: "바질" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "식물 찾기로" }).click();
  await expect(page).toHaveURL(
    `http://127.0.0.1:4173/discover${expectedQuery}`,
  );
  await expect(page.getByRole("searchbox")).toHaveValue("바질");
  await expect(page.getByLabel("식물 유형")).toHaveValue("허브");
  await expect(page.getByLabel("재배 장소")).toHaveValue("베란다");
  await expect(page.getByLabel("계절")).toHaveValue("여름");
  await expect(page.getByText("1종", { exact: true })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(
    `http://127.0.0.1:4173/discover/demo-basil${expectedQuery}`,
  );
  await expect(
    page.getByRole("heading", { level: 1, name: "바질" }),
  ).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL(
    `http://127.0.0.1:4173/discover${expectedQuery}`,
  );
  await expect(page.getByRole("searchbox")).toHaveValue("바질");
  await expect(page.getByText("1종", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "검색 및 필터 초기화" }).click();
  await expect(page).toHaveURL("http://127.0.0.1:4173/discover");
  await expect(page.getByRole("searchbox")).toHaveValue("");
  await expect(page.getByLabel("식물 유형")).toHaveValue("");
  await expect(page.getByLabel("재배 장소")).toHaveValue("");
  await expect(page.getByLabel("계절")).toHaveValue("");
  await expect(page.getByText("3종", { exact: true })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(
    `http://127.0.0.1:4173/discover${expectedQuery}`,
  );
  await expect(page.getByRole("searchbox")).toHaveValue("바질");
  await expect(page.getByText("1종", { exact: true })).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL("http://127.0.0.1:4173/discover");
  await expect(page.getByRole("searchbox")).toHaveValue("");
  await expect(page.getByText("3종", { exact: true })).toBeVisible();

  await page.goto("/discover/demo-monstera");
  await page.getByRole("link", { name: "식물 찾기로" }).click();
  await expect(page).toHaveURL("http://127.0.0.1:4173/discover");
  await expect(page.getByText("3종", { exact: true })).toBeVisible();

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

test("200 percent text and reduced motion reflow across screens and expanded states", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });

  const apply200PercentAndCheckOverflow = async () => {
    await page.addStyleTag({ content: "html { font-size: 200%; }" });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  };

  //+_+// Verify prefers-reduced-motion: reduce computed style rules are applied
  await page.goto("/");
  await apply200PercentAndCheckOverflow();
  const motionStyle = await page.locator("main").evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      animationName: style.animationName,
      transitionDuration: style.transitionDuration,
      scrollBehavior: style.scrollBehavior,
    };
  });
  expect(motionStyle.animationName).toBe("none");
  expect(motionStyle.transitionDuration).toBe("0s");
  expect(motionStyle.scrollBehavior).toBe("auto");

  //+_+// 1. Today screen with demo tasks expanded
  await page.getByRole("checkbox", { name: "개발용 관리 카드 보기" }).check();
  await page
    .getByRole("button", { name: "데모 작업 모두 보기 (4개)" })
    .click();
  await expect(
    page.getByRole("button", { name: "물주기 기록 준비 중" }),
  ).toHaveCount(4);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  //+_+// 2. My Plants sample details expanded and preview tabs
  await page.goto("/plants");
  await apply200PercentAndCheckOverflow();
  for (const summary of await page.locator("summary").all()) {
    await summary.click();
  }
  await expect(
    page.getByRole("link", { name: "식물 상세 화면 미리보기" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "몬스테라 상세정보" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  await page.goto("/plants/preview");
  await apply200PercentAndCheckOverflow();
  for (const tab of ["타임라인", "관리 계획", "성장 사진", "식물 정보"]) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }

  //+_+// 3. Journal timeline, calendar, and compose form
  await page.goto("/journal");
  await apply200PercentAndCheckOverflow();
  await page.getByRole("button", { name: "달력", exact: true }).click();
  await expect(page.getByRole("table")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  await page.goto("/journal/new");
  await apply200PercentAndCheckOverflow();
  await page.getByLabel("제목 (선택)").fill("200% 확대 입력 확인");
  await expect(
    page.getByRole("button", { name: "미리보기 입력 비우기" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  //+_+// 4. Discover results and detail screen
  await page.goto("/discover?q=바질&season=여름");
  await apply200PercentAndCheckOverflow();
  await expect(page.getByRole("link", { name: "바질 상세정보" })).toBeVisible();
  await page.goto("/discover/demo-basil?q=바질&season=여름");
  await apply200PercentAndCheckOverflow();
  await expect(page.getByRole("link", { name: "식물 찾기로" })).toBeVisible();

  //+_+// 5. Settings screen
  await page.goto("/settings");
  await apply200PercentAndCheckOverflow();
  await expect(
    page.getByRole("button", { name: "ZIP 내보내기 · Phase 4 예정" }),
  ).toBeVisible();
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

test("SW initial precache failure and update failure over active worker", async ({
  browser,
}) => {
  const file = "dist/sw.js";
  const original = readFileSync(file, "utf8");
  const brokenInitialSw = original
    .replace(
      /sikmulwang-shell-([a-f0-9]+)/,
      "sikmulwang-shell-broken-initial",
    )
    .replace(
      "caches.open(CACHE).then((cache) => cache.addAll(FILES))",
      'Promise.reject(new Error("initial precache failed"))',
    );
  const brokenUpdateSw = original
    .replace(
      /sikmulwang-shell-([a-f0-9]+)/,
      "sikmulwang-shell-broken-update",
    )
    .replace(
      "caches.open(CACHE).then((cache) => cache.addAll(FILES))",
      'Promise.reject(new Error("update precache failed"))',
    );

  //+_+// 1. Initial install precache failure with no active worker transitions to error
  const failContext = await browser.newContext();
  try {
    writeFileSync(file, brokenInitialSw);
    const failPage = await failContext.newPage();
    await failPage.goto("/settings");
    await expect(
      failPage.getByText("오프라인 준비 실패", { exact: true }),
    ).toBeVisible();
    await expect(
      failPage.getByText("오프라인 준비 실패 · 온라인에서 다시 열어 주세요"),
    ).toBeVisible();
  } finally {
    writeFileSync(file, original);
    await failContext.close();
  }

  //+_+// 2. Update precache failure over an active worker preserves ready status and shows update error
  const updateFailContext = await browser.newContext();
  try {
    const activePage = await updateFailContext.newPage();
    await activePage.goto("/settings");
    await activePage.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await expect
      .poll(() =>
        activePage.evaluate(() => !!navigator.serviceWorker.controller),
      )
      .toBe(true);
    await expect(
      activePage.getByText("앱 셸 오프라인 준비됨", { exact: true }),
    ).toBeVisible();

    writeFileSync(file, brokenUpdateSw);
    await activePage.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration?.update();
    });
    await expect(activePage.getByRole("alert")).toContainText(
      "새 버전 업데이트에 실패했어요. 현재 오프라인 화면은 계속 이용할 수 있어요.",
    );
    await expect(
      activePage.getByText("앱 셸 오프라인 준비됨", { exact: true }),
    ).toBeVisible();
    await expect(
      activePage.getByText("새 버전 업데이트 실패 · 기존 오프라인 화면 유지됨"),
    ).toBeVisible();
  } finally {
    writeFileSync(file, original);
    await updateFailContext.close();
  }
});

test("desktop and mobile visual evidence", async ({ page }) => {
  const expectedScreens: Array<[string, string, string, string]> = [
    ["today", "/", "오늘도, 초록과 함께", "오늘의 돌봄"],
    ["discover", "/discover", "식물 찾기", "샘플 탐색 결과"],
    ["plants", "/plants", "내 식물", "아직 함께하는 식물이 없어요"],
    ["journal", "/journal", "일기장", "첫 이야기를 기다리고 있어요"],
    ["settings", "/settings", "설정 및 데이터 관리", "백업 및 복원"],
  ];

  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [name, path, expectedTitle, expectedText] of expectedScreens) {
      await page.goto(path);
      await expect(
        page.getByRole("heading", { level: 1, name: expectedTitle }),
      ).toBeVisible();
      await expect(page.getByText(expectedText).first()).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "화면을 준비하지 못했어요" }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("heading", { name: "페이지를 찾을 수 없어요" }),
      ).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);

      //+_+// Ensure unfocused skip link is clipped and never visually exposed in captures
      const skipClip = await page
        .getByRole("link", { name: "본문으로 건너뛰기" })
        .evaluate((el) => {
          const style = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return {
            clipPath: style.clipPath,
            overflow: style.overflow,
            width: rect.width,
            height: rect.height,
          };
        });
      expect(skipClip.clipPath).toBe("inset(50%)");
      expect(skipClip.overflow).toBe("hidden");
      expect(skipClip.width).toBeLessThanOrEqual(1);
      expect(skipClip.height).toBeLessThanOrEqual(1);

      if (width < 768) {
        const navBox = await page.getByRole("navigation").boundingBox();
        const headingBox = await page
          .getByRole("heading", { level: 1, name: expectedTitle })
          .boundingBox();
        expect(navBox).not.toBeNull();
        expect(headingBox).not.toBeNull();
        expect(headingBox!.y + headingBox!.height).toBeLessThan(navBox!.y);
      }

      //+_+// Primary viewport capture
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: `test-results/screenshots/${name}-${width}.png`,
        fullPage: false,
      });

      //+_+// Auxiliary full-page capture
      await page.screenshot({
        path: `test-results/screenshots/${name}-${width}-full.png`,
        fullPage: true,
      });
    }
  }
});

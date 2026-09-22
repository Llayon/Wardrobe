import { test, expect } from "@playwright/test";
import {
  blockTelegramScript,
  createTempImage,
  fakeTelegramInitData,
  hashLaunchUrl,
} from "./helpers.js";

/**
 * Platform integration E2E (mock Platform, zero quota). The dev server runs
 * with PLATFORM_INTEGRATION_ENABLED=true and no service token, so the shared
 * mock answers. Isolation via POST /api/platform/dev/reset + unique users.
 */

async function telegramPage(page: import("@playwright/test").Page, userId: number) {
  await blockTelegramScript(page);
  await page.addInitScript((initData: string) => {
    (window as unknown as Record<string, unknown>)["Telegram"] = { WebApp: { initData } };
  }, fakeTelegramInitData(userId));
}

async function platformReset(request: import("@playwright/test").APIRequestContext) {
  const res = await request.post("/api/platform/dev/reset");
  expect(res.ok()).toBeTruthy();
}

test.describe("platform integration (mock)", () => {
  test.beforeEach(async ({ request }) => {
    await platformReset(request);
  });

  test("anonymous web: no balance chip, landing intact", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("landing")).toBeVisible();
    await expect(page.getByTestId("balance-chip")).toHaveCount(0);
  });

  test("telegram mock: balance 10 with wardrobe app session", async ({ page }) => {
    await telegramPage(page, 9101);
    await page.goto("/");
    await expect(page.getByTestId("balance-chip")).toContainText("10 AI-кредитов", {
      timeout: 10000,
    });
  });

  test("hash launch (WebK style, no bridge): balance 10 via fallback", async ({ page }) => {
    await page.goto(hashLaunchUrl(9105));
    await expect(page.getByTestId("balance-chip")).toContainText("10 AI-кредитов", {
      timeout: 10000,
    });
  });

  test("zero credits: chip shows 0, no crash", async ({ page }) => {
    await telegramPage(page, 9102);
    await page.route("**/api/platform/exchange", async (route) => {
      const headers = {
        ...route.request().headers(),
        "x-platform-mock": '{"reset":true,"initialBalance":0}',
      };
      await route.continue({ headers });
    });
    await page.goto("/");
    await expect(page.getByTestId("balance-chip")).toContainText("0 AI-кредитов", {
      timeout: 10000,
    });
  });

  test("platform outage: retryable auth error, recovery on retry", async ({ page }) => {
    await telegramPage(page, 9103);
    let failExchange = true;
    await page.route("**/api/platform/exchange", async (route) => {
      const scenario = failExchange
        ? '{"reset":true,"exchangeFail":true}'
        : '{"exchangeFail":false}';
      const headers = { ...route.request().headers(), "x-platform-mock": scenario };
      await route.continue({ headers });
    });
    await page.goto("/");
    await expect(page.getByTestId("auth-error")).toBeVisible({ timeout: 10000 });
    failExchange = false;
    await page.getByTestId("auth-retry").click();
    await expect(page.getByTestId("landing")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("balance-chip")).toContainText("AI-кредит", { timeout: 10000 });
  });

  test("full flow: upload → candidates → confirm → grid, 10 → 9", async ({ page }) => {
    await telegramPage(page, 9201);
    await page.goto("/");
    await expect(page.getByTestId("balance-chip")).toContainText("10 AI-кредитов", {
      timeout: 10000,
    });

    const imgPath = await createTempImage("test-wardrobe-flow.png");
    await page.getByTestId("input-upload").setInputFiles(imgPath);
    await expect(page.getByTestId("photo-step")).toBeVisible({ timeout: 8000 });
    await page.getByTestId("analyze-btn").click();
    await expect(page.getByTestId("candidates-step")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("candidate-black_jeans")).toBeVisible();

    await page.getByTestId("confirm-btn").click();
    await expect(page.getByTestId("grid")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("item-black_jeans")).toBeVisible();
    await expect(page.getByTestId("thumb-black_jeans")).toBeVisible();
    await expect(page.getByTestId("balance-chip")).toContainText("9 AI-кредитов");
  });

  test("authenticated viewports 360/390/430: no overflow, chip visible", async ({ page }) => {
    await telegramPage(page, 9104);
    await page.goto("/");
    await expect(page.getByTestId("balance-chip")).toBeVisible({ timeout: 10000 });
    for (const w of [360, 390, 430]) {
      await page.setViewportSize({ width: w, height: 800 });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
      await expect(page.getByTestId("balance-chip")).toBeVisible();
    }
  });
});

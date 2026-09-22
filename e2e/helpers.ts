/** Fake Telegram Mini App bridge payload (signature never checked client-side). */
export function fakeTelegramInitData(userId = 4242): string {
  const user = encodeURIComponent(JSON.stringify({ id: userId, first_name: "E2E" }));
  return `user=${user}&auth_date=${Math.floor(Date.now() / 1000)}&hash=fake`;
}

/**
 * Block the real telegram-web-app.js in E2E: it would overwrite the faked
 * window.Telegram with an empty bridge (no parent frame to wire). Production
 * keeps the script; tests isolate each detection path explicitly.
 */
export async function blockTelegramScript(page: import("@playwright/test").Page): Promise<void> {
  await page.route("https://telegram.org/js/telegram-web-app.js", async (route) => {
    await route.abort();
  });
}

/** WebK-style launch: initData travels in the location hash, no bridge. */
export function hashLaunchUrl(userId = 4242): string {
  return `/#tgWebAppData=${encodeURIComponent(fakeTelegramInitData(userId))}&tgWebAppVersion=8.0`;
}

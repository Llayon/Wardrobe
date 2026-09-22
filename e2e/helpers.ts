/** Fake Telegram Mini App bridge payload (signature never checked client-side). */
export function fakeTelegramInitData(userId = 4242): string {
  const user = encodeURIComponent(JSON.stringify({ id: userId, first_name: "E2E" }));
  return `user=${user}&auth_date=${Math.floor(Date.now() / 1000)}&hash=fake`;
}

/** Valid small JPEG for upload flows (decodable, >500 bytes). */
export async function createTempImage(filename = "wardrobe-test.png"): Promise<string> {
  const path = await import("node:path");
  const filePath = path.join(process.cwd(), filename);
  const { default: sharp } = await import("sharp");
  const svg = `<svg width="800" height="600" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#e8e4da"/><rect x="300" y="80" width="200" height="440" rx="12" fill="#1f2937"/><rect x="100" y="120" width="160" height="200" rx="8" fill="#f5f5f5"/></svg>`;
  await sharp({
    create: { width: 800, height: 600, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 80, mozjpeg: true })
    .toFile(filePath);
  return filePath;
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

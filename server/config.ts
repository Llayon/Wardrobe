import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const config = {
  port: parseInt(process.env.PORT ?? "3003", 10),
  mockMode: process.env.MOCK_MODE === "true",
  maxImageBytes: 300 * 1024, // 300KB decoded, same ceiling as Holodilnik
  // UserPlatform integration (Gauntlet 1+ wiring lands here; all server-only).
  platformIntegrationEnabled: process.env.PLATFORM_INTEGRATION_ENABLED === "true",
  userPlatformUrl: process.env.USER_PLATFORM_URL ?? "https://user-platform-phi.vercel.app",
  userPlatformServiceToken: process.env.USER_PLATFORM_SERVICE_TOKEN ?? "",
  platformSessionCookieName: process.env.PLATFORM_SESSION_COOKIE_NAME ?? "wardrobe_session",
  visionDeviceDailyLimit: parsePositiveInt(process.env.VISION_DEVICE_DAILY_LIMIT, 5),
  visionIpDailyLimit: parsePositiveInt(process.env.VISION_IP_DAILY_LIMIT, 20),
  authVisionUserDailyLimit: parsePositiveInt(process.env.AUTH_VISION_USER_DAILY_LIMIT, 30),
  authVisionIpDailyLimit: parsePositiveInt(process.env.AUTH_VISION_IP_DAILY_LIMIT, 200),
};

export function isMockMode(): boolean {
  if (process.env.MOCK_MODE === "true") return true;
  if (config.mockMode) return true;
  return false;
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Live env read (not the load-time snapshot): tests toggle the flag per-test. */
export function isPlatformIntegrationEnabled(): boolean {
  return process.env.PLATFORM_INTEGRATION_ENABLED === "true";
}

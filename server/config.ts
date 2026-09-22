import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const GROQ_MODEL_ID = "qwen/qwen3.8-27b" as const;
export const GROQ_VISION_MAX_COMPLETION_TOKENS = 800 as const;
export const ZAI_MODEL_ID = "glm-4.6v-flash" as const;
export const ZAI_API_BASE = "https://api.z.ai/api/paas/v4" as const;
export const ZAI_VISION_PROMPT_VERSION = "wardrobe-vision-v1" as const;
export const VISION_PRIMARY = "zai" as const;
export const VISION_FALLBACK = "groq" as const;

export const config = {
  port: parseInt(process.env.PORT ?? "3003", 10),
  mockMode: process.env.MOCK_MODE === "true",
  groqApiKey: process.env.GROQ_API_KEY ?? "",
  zaiApiKey: process.env.ZAI_API_KEY ?? "",
  groqModelId: GROQ_MODEL_ID,
  zaiModelId: ZAI_MODEL_ID,
  zaiApiBase: ZAI_API_BASE,
  visionPrimary: (process.env.VISION_PRIMARY ?? VISION_PRIMARY) as string,
  visionFallback: (process.env.VISION_FALLBACK ?? VISION_FALLBACK) as string,
  zaiTimeoutMs: parsePositiveInt(process.env.ZAI_TIMEOUT_MS, 10000),
  groqTimeoutMs: parsePositiveInt(process.env.GROQ_TIMEOUT_MS, 15000),
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

function isValidKey(key: string): boolean {
  if (!key) return false;
  // eslint-disable-next-line no-control-regex
  if (/[^\x00-\x7F]/.test(key)) return false;
  if (key.includes("твой") || key.includes("YOUR") || key.toLowerCase().includes("placeholder"))
    return false;
  if (key.trim().length < 20) return false;
  return true;
}

export function isGroqAvailable(): boolean {
  if (config.mockMode) return false;
  return isValidKey(config.groqApiKey);
}

export function isZaiAvailable(): boolean {
  if (config.mockMode) return false;
  return isValidKey(config.zaiApiKey);
}

export function isMockMode(): boolean {
  if (process.env.MOCK_MODE === "true") return true;
  if (config.mockMode) return true;
  if (!config.groqApiKey && !config.zaiApiKey) return true;
  if (!isGroqAvailable() && !isZaiAvailable()) return true;
  return false;
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Live env read (not the load-time snapshot): tests toggle the flag per-test. */
export function isPlatformIntegrationEnabled(): boolean {
  return process.env.PLATFORM_INTEGRATION_ENABLED === "true";
}

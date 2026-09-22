import crypto from "node:crypto";
import type { Request } from "express";
import { config } from "./config.js";

/**
 * Wardrobe rate limiting (mirrors the proven Holodilnik shape).
 *
 * Key namespace is `wr:*` — deliberately distinct from Holodilnik's keys so
 * a shared Upstash/Redis instance never mixes the two apps' counters.
 * Privacy: raw IPs / device IDs / user UUIDs are never persisted, only
 * SHA-256 hashes + UTC daily bucket, TTL slightly above 24h.
 */

export const DEVICE_HEADER = "x-wardrobe-device-id";

export interface RateLimitStore {
  readonly name: string;
  readonly isDurable: boolean;
  get(key: string): Promise<number>;
  incr(key: string, ttlSeconds: number): Promise<number>;
  clear(): Promise<void>;
}

export class MemoryRateLimitStore implements RateLimitStore {
  readonly name = "memory";
  readonly isDurable = false;
  private counts = new Map<string, { count: number; expiresAt: number }>();

  async get(key: string): Promise<number> {
    const entry = this.counts.get(key);
    if (!entry) return 0;
    if (Date.now() > entry.expiresAt) {
      this.counts.delete(key);
      return 0;
    }
    return entry.count;
  }

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const now = Date.now();
    const entry = this.counts.get(key);
    if (!entry || now > entry.expiresAt) {
      const fresh = { count: 1, expiresAt: now + ttlSeconds * 1000 };
      this.counts.set(key, fresh);
      return 1;
    }
    entry.count += 1;
    return entry.count;
  }

  async clear(): Promise<void> {
    this.counts.clear();
  }
}

export class UpstashRedisRateLimitStore implements RateLimitStore {
  readonly name = "upstash-redis";
  readonly isDurable = true;
  private url: string;
  private token: string;

  constructor(url: string, token: string) {
    this.url = url.replace(/\/$/, "");
    this.token = token;
  }

  private async call<T>(path: string, method = "POST"): Promise<T> {
    const res = await fetch(`${this.url}/${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) throw new Error(`Redis REST ${res.status}`);
    const json = (await res.json()) as { result?: T };
    return json.result as T;
  }

  async get(key: string): Promise<number> {
    const raw = await this.call<string | number | null>(`get/${encodeURIComponent(key)}`);
    if (raw === null || raw === undefined) return 0;
    const n = typeof raw === "number" ? raw : parseInt(String(raw), 10);
    return Number.isFinite(n) ? n : 0;
  }

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const count = await this.call<number>(`incr/${encodeURIComponent(key)}`);
    if (count === 1) {
      try {
        await this.call<number>(`expire/${encodeURIComponent(key)}/${ttlSeconds}`);
      } catch (err) {
        console.error("[rateLimit] redis EXPIRE failed:", String(err).slice(0, 200));
      }
    }
    return count;
  }

  async clear(): Promise<void> {
    throw new Error("clear() not supported on production Redis store");
  }
}

export function getRedisCredentials(): { url: string; token: string } | null {
  const resolvedUrl = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const resolvedToken = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (resolvedUrl && resolvedToken) return { url: resolvedUrl, token: resolvedToken };
  return null;
}

let singleton: RateLimitStore | null = null;

export function getRateLimitStore(): RateLimitStore {
  if (singleton) return singleton;
  const creds = getRedisCredentials();
  if (creds) {
    singleton = new UpstashRedisRateLimitStore(creds.url, creds.token);
    return singleton;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "RATE_LIMIT_STORE_UNAVAILABLE: no UPSTASH_REDIS_REST_URL/TOKEN (or KV_REST_API_URL/TOKEN) in production",
    );
  }
  singleton = new MemoryRateLimitStore();
  return singleton;
}

/** For tests: inject a fresh memory store. */
export function __setRateLimitStoreForTests(store: RateLimitStore): void {
  singleton = store;
}

export function __resetRateLimitStoreForTests(): void {
  singleton = null;
}

// ---------- identifiers ----------

export function getDailyBucket(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function ttlUntilEndOfDaySeconds(now = new Date()): number {
  const midnightUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const diffSec = Math.max(1, Math.floor((midnightUtc - now.getTime()) / 1000));
  return diffSec + 3600;
}

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function getClientIp(req: Request): string | undefined {
  const realIp = (req.headers["x-real-ip"] as string | undefined)?.split(",")[0]?.trim();
  if (realIp) return normalizeIp(realIp);
  const forwarded = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim();
  if (forwarded) return normalizeIp(forwarded);
  const vercelForwarded = (req.headers["x-vercel-forwarded-for"] as string | undefined)
    ?.split(",")[0]
    ?.trim();
  if (vercelForwarded) return normalizeIp(vercelForwarded);
  const socketIp =
    (req as unknown as { ip?: string }).ip ??
    (req.socket as unknown as { remoteAddress?: string } | undefined)?.remoteAddress;
  if (socketIp) return normalizeIp(socketIp);
  return undefined;
}

export function normalizeIp(raw: string): string {
  let ip = raw.trim().toLowerCase();
  if (ip.startsWith("[") && ip.includes("]")) ip = ip.slice(1, ip.indexOf("]"));
  const colonCount = (ip.match(/:/g) ?? []).length;
  if (colonCount === 1 && /^\d+\.\d+\.\d+\.\d+:\d+$/.test(ip)) ip = ip.split(":")[0];
  if (ip.includes("%")) ip = ip.split("%")[0];
  return ip;
}

export function parseDeviceId(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim();
  if (!v) return undefined;
  if (v.length < 8 || v.length > 128) return undefined;
  if (/[^\x20-\x7E]/.test(v)) return undefined;
  if (!/^[A-Za-z0-9_\-:]+$/.test(v)) return undefined;
  return v;
}

export function hashIp(ip: string): string {
  return sha256Hex(`ip:${normalizeIp(ip)}`);
}

export function hashDevice(deviceId: string): string {
  return sha256Hex(`device:${deviceId}`);
}

export function hashPlatformUser(userId: string): string {
  return sha256Hex(`platform-user:${userId}`);
}

// Wardrobe key namespace (wr:) — never collides with Holodilnik counters on
// a shared Redis instance.
export function visionIpKey(ipHash: string, bucket: string): string {
  return `wr:vision:ip:${ipHash}:${bucket}`;
}
export function visionDeviceKey(deviceHash: string, bucket: string): string {
  return `wr:vision:device:${deviceHash}:${bucket}`;
}
export function authVisionUserKey(userIdHash: string, bucket: string): string {
  return `wr:auth:vision:user:${userIdHash}:${bucket}`;
}
export function authVisionIpKey(ipHash: string, bucket: string): string {
  return `wr:auth:vision:ip:${ipHash}:${bucket}`;
}

// ---------- limit checks ----------

export type LimitKind = "vision";

export interface LimitCheck {
  allowed: boolean;
  reason?: "device" | "ip";
  deviceCount?: number;
  ipCount?: number;
}

export const DAILY_LIMIT_MESSAGE =
  "На сегодня лимит тестовых запросов исчерпан. Попробуйте завтра.";

export const AUTH_ABUSE_MESSAGE = "Слишком много запросов за сегодня. Попробуйте завтра.";

export async function checkLimits(
  kind: LimitKind,
  opts: { ip?: string; deviceId?: string; bucket?: string },
): Promise<LimitCheck> {
  void kind;
  const store = getRateLimitStore();
  const bucket = opts.bucket ?? getDailyBucket();
  if (opts.deviceId) {
    const deviceCount = await store.get(visionDeviceKey(hashDevice(opts.deviceId), bucket));
    if (deviceCount >= config.visionDeviceDailyLimit)
      return { allowed: false, reason: "device", deviceCount };
  }
  let ipCount: number | undefined;
  if (opts.ip) {
    ipCount = await store.get(visionIpKey(hashIp(opts.ip), bucket));
    if (ipCount >= config.visionIpDailyLimit) return { allowed: false, reason: "ip", ipCount };
  }
  return { allowed: true, ipCount };
}

export async function recordUsage(
  kind: LimitKind,
  opts: { ip?: string; deviceId?: string; bucket?: string; ttlSeconds?: number },
): Promise<void> {
  void kind;
  const store = getRateLimitStore();
  const bucket = opts.bucket ?? getDailyBucket();
  const ttl = opts.ttlSeconds ?? ttlUntilEndOfDaySeconds();
  const jobs: Array<Promise<number>> = [];
  if (opts.deviceId) jobs.push(store.incr(visionDeviceKey(hashDevice(opts.deviceId), bucket), ttl));
  if (opts.ip) jobs.push(store.incr(visionIpKey(hashIp(opts.ip), bucket), ttl));
  await Promise.all(jobs);
}

export async function checkAuthVisionLimits(opts: {
  userId: string;
  ip?: string;
  bucket?: string;
}): Promise<LimitCheck> {
  const store = getRateLimitStore();
  const bucket = opts.bucket ?? getDailyBucket();
  const userCount = await store.get(authVisionUserKey(hashPlatformUser(opts.userId), bucket));
  if (userCount >= config.authVisionUserDailyLimit) {
    return { allowed: false, reason: "device", deviceCount: userCount };
  }
  let ipCount: number | undefined;
  if (opts.ip) {
    ipCount = await store.get(authVisionIpKey(hashIp(opts.ip), bucket));
    if (ipCount >= config.authVisionIpDailyLimit) {
      return { allowed: false, reason: "ip", deviceCount: userCount, ipCount };
    }
  }
  return { allowed: true, deviceCount: userCount, ipCount };
}

export async function recordAuthVisionUsage(opts: {
  userId: string;
  ip?: string;
  bucket?: string;
  ttlSeconds?: number;
}): Promise<void> {
  const store = getRateLimitStore();
  const bucket = opts.bucket ?? getDailyBucket();
  const ttl = opts.ttlSeconds ?? ttlUntilEndOfDaySeconds();
  const jobs: Array<Promise<number>> = [
    store.incr(authVisionUserKey(hashPlatformUser(opts.userId), bucket), ttl),
  ];
  if (opts.ip) jobs.push(store.incr(authVisionIpKey(hashIp(opts.ip), bucket), ttl));
  await Promise.all(jobs);
}

export function limitExceededResponse() {
  return {
    status: 429 as const,
    body: { error: DAILY_LIMIT_MESSAGE, code: "DAILY_LIMIT_REACHED" as const },
  };
}

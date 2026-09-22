import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { config, isPlatformIntegrationEnabled } from "../config.js";
import {
  confirmRequestSchema,
  scanRequestSchema,
  storedItemSchema,
} from "../../shared/wardrobe.js";
import { WardrobeVisionChain } from "../vision/router.js";
import {
  checkAuthVisionLimits,
  checkLimits,
  getClientIp,
  limitExceededResponse,
  parseDeviceId,
  recordAuthVisionUsage,
  recordUsage,
  DEVICE_HEADER,
} from "../rateLimit.js";
import { PlatformError } from "../platform/errors.js";
import { recallSettlement, runExclusive, storeSettlement } from "../platform/settlement.js";
import { requestPlatformClient, requestPlatformSession } from "./platform.js";
import {
  StoreConflictError,
  getWardrobeStore,
  thumbnailPath,
  type WardrobeStore,
} from "../store/items.js";
import { ThumbnailTooLargeError, makeThumbnail as buildThumbnail } from "../store/thumbnails.js";

const router = Router();

export const SCAN_OPERATION = "wardrobe.scan";
const SCAN_AUTH_ABUSE_MESSAGE = "Слишком много запросов за сегодня. Попробуйте завтра.";
const INSUFFICIENT_MESSAGE = "Кредиты закончились — новые начисления скоро появятся.";
const PLATFORM_DOWN_MESSAGE = "Сервис аккаунта временно недоступен";
const COMMIT_UNCERTAIN_MESSAGE =
  "Не удалось подтвердить списание — повторите запрос, повторная оплата не спишется.";

// ---------- shared image validation (runs BEFORE reserve AND before persist) ----------

interface ValidImage {
  base64Part: string;
  effectiveMime: string;
}

function validateImageInput(
  res: Response,
  imageBase64: string,
  mimeType: string | undefined,
): { ok: false } | { ok: true; image: ValidImage } {
  const base64Part = imageBase64.includes(",") ? imageBase64.split(",")[1] : imageBase64;
  let bytes: number;
  try {
    bytes = Buffer.from(base64Part.trim(), "base64").length;
    if (bytes === 0 && base64Part.trim().length > 0) {
      bytes = Math.ceil((base64Part.trim().length * 3) / 4);
    }
  } catch {
    bytes = Math.ceil((base64Part.trim().length * 3) / 4);
  }
  if (bytes > config.maxImageBytes) {
    res.status(413).json({
      error: "Фото слишком большое — выберите другое (максимум 300 КБ)",
      code: "IMAGE_TOO_LARGE",
    });
    return { ok: false };
  }
  if (bytes < 500) {
    res.status(400).json({ error: "Invalid image data", code: "INVALID_IMAGE" });
    return { ok: false };
  }
  const effectiveMime = mimeType || "image/jpeg";
  const allowedMimes = ["image/jpeg", "image/png", "image/webp"];
  if (!allowedMimes.includes(effectiveMime) && !effectiveMime.startsWith("image/")) {
    res.status(400).json({ error: "Unsupported image type", code: "UNSUPPORTED_MIME" });
    return { ok: false };
  }
  let isHeicContent = false;
  try {
    const header = Buffer.from(base64Part.slice(0, 32), "base64").toString("ascii");
    if (header.includes("ftyp")) isHeicContent = true;
  } catch {
    // ignore
  }
  if (effectiveMime === "image/heic" || effectiveMime === "image/heif" || isHeicContent) {
    res.status(400).json({
      error: "HEIC не поддерживается — сохраните фото как JPEG и загрузите снова",
      code: "UNSUPPORTED_MIME",
    });
    return { ok: false };
  }
  return { ok: true, image: { base64Part, effectiveMime } };
}

// ---------- POST /scan ----------

router.post("/scan", async (req, res) => {
  const requestLogId = crypto.randomUUID().slice(0, 8);
  const startedAt = Date.now();
  try {
    const parsed = scanRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request payload", code: "INVALID_PAYLOAD" });
    }
    const checked = validateImageInput(res, parsed.data.imageBase64, parsed.data.mimeType);
    if (!checked.ok) return res;
    const { base64Part, effectiveMime } = checked.image;

    const sessionToken = isPlatformIntegrationEnabled() ? requestPlatformSession(req) : undefined;
    if (sessionToken) {
      return handleAuthenticatedScan(req, res, {
        base64Part,
        effectiveMime,
        clientRequestId: parsed.data.requestId,
        requestLogId,
        startedAt,
        sessionToken,
      });
    }
    return handleAnonymousScan(req, res, { base64Part, effectiveMime, requestLogId, startedAt });
  } catch (err) {
    console.error(`[scan] rid=${requestLogId} error msg=${String(err).slice(0, 300)}`);
    return res.status(502).json({ error: "Ошибка анализа изображения", code: "PROVIDER_ERROR" });
  }
});

async function handleAnonymousScan(
  req: Request,
  res: Response,
  ctx: { base64Part: string; effectiveMime: string; requestLogId: string; startedAt: number },
): Promise<Response> {
  const ip = getClientIp(req);
  const deviceId = parseDeviceId(req.headers[DEVICE_HEADER]);
  let limits;
  try {
    limits = await checkLimits("vision", { ip, deviceId });
  } catch (storeErr) {
    console.error(
      `[scan] rid=${ctx.requestLogId} rate_limit_store_unavailable msg=${String(storeErr).slice(0, 200)}`,
    );
    return res.status(503).json({
      error: "Сервис временно недоступен, попробуйте позже",
      code: "RATE_LIMIT_UNAVAILABLE",
    });
  }
  if (!limits.allowed) {
    const exceeded = limitExceededResponse();
    return res.status(exceeded.status).json(exceeded.body);
  }
  const chain = new WardrobeVisionChain();
  try {
    const { result, provider, modelId } = await chain.analyze({
      imageBase64: ctx.base64Part,
      mimeType: ctx.effectiveMime,
    });
    if (!result.items.length && !result.uncertainItems.length) {
      try {
        await recordUsage("vision", { ip, deviceId });
      } catch (storeErr) {
        console.error(
          `[scan] rid=${ctx.requestLogId} record_usage_failed msg=${String(storeErr).slice(0, 200)}`,
        );
      }
      return res.status(422).json({
        error: "No recognizable garments found",
        code: "NO_GARMENTS_DETECTED",
        data: result,
      });
    }
    try {
      await recordUsage("vision", { ip, deviceId });
    } catch (storeErr) {
      console.error(
        `[scan] rid=${ctx.requestLogId} record_usage_failed msg=${String(storeErr).slice(0, 200)}`,
      );
    }
    console.log(
      `[scan] rid=${ctx.requestLogId} anon provider=${provider} latency=${Date.now() - ctx.startedAt}ms`,
    );
    return res.json({ data: result, meta: { provider, modelId, charged: false } });
  } catch (err) {
    const [status, body] = mapVisionFailure(err);
    return res.status(status).json(body);
  }
}

interface AuthScanCtx {
  base64Part: string;
  effectiveMime: string;
  clientRequestId: string | undefined;
  requestLogId: string;
  startedAt: number;
  sessionToken: string;
}

class ScanFailedError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super("scan failed");
    this.status = status;
    this.body = body;
  }
}

async function handleAuthenticatedScan(
  req: Request,
  res: Response,
  ctx: AuthScanCtx,
): Promise<Response> {
  const client = requestPlatformClient(req);
  let userId: string;
  try {
    userId = (await client.getMe(ctx.sessionToken)).userId;
  } catch (err) {
    return res.status(platformStatus(err)).json(platformBody(err));
  }
  if (!ctx.clientRequestId) {
    return res.status(400).json({ error: "Missing requestId", code: "MISSING_REQUEST_ID" });
  }
  const platformRequestId = `${SCAN_OPERATION}:${ctx.clientRequestId}`;

  const replay = recallSettlement(platformRequestId);
  if (replay) {
    try {
      const settled = await client.commit(ctx.sessionToken, String(replay.reservationId));
      return scanResultResponse(res, replay, {
        available: settled.reservation.availableBalance,
        reserved: settled.reservation.reservedBalance,
      });
    } catch (err) {
      if (err instanceof PlatformError && err.code === "PLATFORM_UNAVAILABLE") {
        return res.status(503).json({
          error: COMMIT_UNCERTAIN_MESSAGE,
          code: "COMMIT_UNCERTAIN",
          requestId: ctx.clientRequestId,
        });
      }
      if (err instanceof PlatformError && (err.status === 404 || err.status === 409)) {
        return scanResultResponse(res, replay, undefined);
      }
      return res.status(platformStatus(err)).json(platformBody(err));
    }
  }

  const ip = getClientIp(req);
  try {
    const limits = await checkAuthVisionLimits({ userId, ip });
    if (!limits.allowed) {
      return res.status(429).json({ error: SCAN_AUTH_ABUSE_MESSAGE, code: "DAILY_LIMIT_REACHED" });
    }
  } catch (storeErr) {
    console.error(
      `[scan] rid=${ctx.requestLogId} rate_limit_store_unavailable msg=${String(storeErr).slice(0, 200)}`,
    );
    return res.status(503).json({
      error: "Сервис временно недоступен, попробуйте позже",
      code: "RATE_LIMIT_UNAVAILABLE",
    });
  }

  let reservationId: string;
  try {
    const out = await client.reserve(ctx.sessionToken, {
      operation: SCAN_OPERATION,
      requestId: platformRequestId,
    });
    reservationId = out.reservation.reservationId;
  } catch (err) {
    if (err instanceof PlatformError && err.code === "INSUFFICIENT_CREDITS") {
      return res.status(402).json({ error: INSUFFICIENT_MESSAGE, code: "INSUFFICIENT_CREDITS" });
    }
    return res.status(platformStatus(err)).json(platformBody(err));
  }

  try {
    const settled = await runExclusive(platformRequestId, () =>
      executeSettlingScan(
        client,
        ctx.sessionToken,
        reservationId,
        platformRequestId,
        ctx,
        userId,
        ip,
      ),
    );
    if (settled.empty) {
      return res.status(422).json({
        error: "No recognizable garments found",
        code: "NO_GARMENTS_DETECTED",
        data: settled.result,
        meta: successMeta(settled),
      });
    }
    return res.json({ data: settled.result, meta: successMeta(settled) });
  } catch (err) {
    if (err instanceof ScanFailedError) {
      return res.status(err.status).json({ ...err.body, requestId: ctx.clientRequestId });
    }
    return res.status(502).json({ error: "Ошибка анализа изображения", code: "PROVIDER_ERROR" });
  }
}

interface SettledWithBalance {
  result: import("../../shared/wardrobe.js").WardrobeScan;
  provider: string;
  modelId: string;
  reservationId: string;
  empty: boolean;
  available?: number;
  reserved?: number;
}

function successMeta(settled: SettledWithBalance): Record<string, unknown> {
  const chain = new WardrobeVisionChain();
  return {
    provider: settled.provider,
    modelId: settled.modelId,
    primary: chain.getPrimaryName(),
    fallback: chain.getFallbackName(),
    balance:
      settled.available !== undefined
        ? { available: settled.available, reserved: settled.reserved ?? 0 }
        : undefined,
    charged: true,
  };
}

function scanResultResponse(
  res: Response,
  replay: { result: unknown; provider: string; modelId: string; empty: boolean },
  balance: { available: number; reserved: number } | undefined,
): Response {
  const settled: SettledWithBalance = {
    result: replay.result as SettledWithBalance["result"],
    provider: replay.provider,
    modelId: replay.modelId,
    reservationId: "",
    empty: replay.empty,
    ...(balance ? { available: balance.available, reserved: balance.reserved } : {}),
  };
  if (settled.empty) {
    return res.status(422).json({
      error: "No recognizable garments found",
      code: "NO_GARMENTS_DETECTED",
      data: settled.result,
      meta: successMeta(settled),
    });
  }
  return res.json({ data: settled.result, meta: successMeta(settled) });
}

async function executeSettlingScan(
  client: ReturnType<typeof requestPlatformClient>,
  token: string,
  reservationId: string,
  platformRequestId: string,
  ctx: AuthScanCtx,
  userId: string,
  ip: string | undefined,
): Promise<SettledWithBalance> {
  const chain = new WardrobeVisionChain();
  let result;
  let provider = chain.getPrimaryName();
  let modelId = "unknown";
  try {
    const out = await chain.analyze({ imageBase64: ctx.base64Part, mimeType: ctx.effectiveMime });
    result = out.result;
    provider = out.provider;
    modelId = out.modelId;
  } catch (aiErr) {
    await releaseBestEffort(client, token, reservationId, ctx.requestLogId);
    throw new ScanFailedError(...mapVisionFailure(aiErr));
  }
  const empty = result.items.length === 0 && result.uncertainItems.length === 0;
  try {
    const committed = await client.commit(token, reservationId);
    try {
      await recordAuthVisionUsage({ userId, ip });
    } catch (storeErr) {
      console.error(
        `[scan] rid=${ctx.requestLogId} record_usage_failed msg=${String(storeErr).slice(0, 200)}`,
      );
    }
    console.log(
      `[scan] rid=${ctx.requestLogId} auth committed provider=${provider} empty=${empty} latency=${Date.now() - ctx.startedAt}ms`,
    );
    const settled: SettledWithBalance = {
      result,
      provider,
      modelId,
      reservationId,
      empty,
      available: committed.reservation.availableBalance,
      reserved: committed.reservation.reservedBalance,
    };
    storeSettlement(platformRequestId, { ...settled, result });
    return settled;
  } catch (err) {
    if (err instanceof PlatformError && err.code === "PLATFORM_UNAVAILABLE") {
      storeSettlement(platformRequestId, { result, provider, modelId, reservationId, empty });
      throw new ScanFailedError(503, {
        error: COMMIT_UNCERTAIN_MESSAGE,
        code: "COMMIT_UNCERTAIN",
      });
    }
    if (err instanceof PlatformError && (err.status === 404 || err.status === 409)) {
      const settled: SettledWithBalance = { result, provider, modelId, reservationId, empty };
      storeSettlement(platformRequestId, { ...settled, result });
      return settled;
    }
    throw new ScanFailedError(platformStatus(err), platformBody(err));
  }
}

async function releaseBestEffort(
  client: ReturnType<typeof requestPlatformClient>,
  token: string,
  reservationId: string,
  logId: string,
  attempts = 3,
): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      await client.release(token, reservationId);
      return;
    } catch (err) {
      if (err instanceof PlatformError && (err.status === 404 || err.status === 409)) return;
      if (i === attempts - 1) console.error(`[scan] rid=${logId} release_failed_after_retries`);
    }
  }
}

function mapVisionFailure(err: unknown): [number, Record<string, unknown>] {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof PlatformError) return [platformStatus(err), platformBody(err)];
  const lower = message.toLowerCase();
  if (
    lower.includes("quota") ||
    message.includes("429") ||
    message.includes("RESOURCE_EXHAUSTED") ||
    message.includes("503") ||
    lower.includes("unavailable") ||
    lower.includes("high demand")
  ) {
    return [
      429,
      {
        error: "Превышен лимит запросов — подождите 20-30 секунд и попробуйте снова",
        code: "RATE_LIMITED",
      },
    ];
  }
  if (message.includes("Invalid JSON") || message.includes("parse")) {
    return [
      502,
      {
        error: "Не удалось распознать изображение, попробуйте ещё раз",
        code: "INVALID_PROVIDER_RESPONSE",
      },
    ];
  }
  return [502, { error: "Ошибка анализа изображения", code: "PROVIDER_ERROR" }];
}

function platformStatus(err: unknown): number {
  if (err instanceof PlatformError) return err.status;
  return 500;
}

function platformBody(err: unknown): { error: string; code: string } {
  if (err instanceof PlatformError) {
    if (err.code === "SESSION_EXPIRED")
      return { error: "Сессия истекла — войдите заново", code: "SESSION_EXPIRED" };
    if (err.code === "SESSION_FORBIDDEN")
      return { error: "Операция недоступна", code: "FORBIDDEN" };
    if (err.code === "PLATFORM_UNAVAILABLE")
      return { error: PLATFORM_DOWN_MESSAGE, code: "PLATFORM_UNAVAILABLE" };
    return { error: "Ошибка сервиса аккаунта", code: "PLATFORM_ERROR" };
  }
  return { error: "Internal server error", code: "INTERNAL_ERROR" };
}

// ---------- POST /confirm (persistence ONLY after user confirmation) ----------

router.post("/confirm", async (req, res) => {
  if (!isPlatformIntegrationEnabled()) {
    return res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
  }
  const token = requestPlatformSession(req);
  if (!token) {
    return res
      .status(401)
      .json({ error: "Сессия истекла — войдите заново", code: "SESSION_EXPIRED" });
  }
  const parsed = confirmRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request payload", code: "INVALID_PAYLOAD" });
  }
  const client = requestPlatformClient(req);
  let userId: string;
  try {
    userId = (await client.getMe(token)).userId;
  } catch (err) {
    return res.status(platformStatus(err)).json(platformBody(err));
  }
  const platformRequestId = `${SCAN_OPERATION}:${parsed.data.requestId}`;

  // Prove the scan happened: same-key reserve reuses (no charge); a fresh
  // reservation means no scan → release it immediately (balance-neutral) and
  // refuse. The AI output is draft; the confirmed user state is the source
  // of truth — but confirms without scans are not allowed.
  try {
    const proof = await client.reserve(token, {
      operation: SCAN_OPERATION,
      requestId: platformRequestId,
    });
    if (!proof.reused) {
      try {
        await client.release(token, proof.reservation.reservationId);
      } catch {
        // Best-effort: release writes no ledger row; sweeper recovers.
      }
      return res
        .status(409)
        .json({ error: "Scan first — nothing to confirm", code: "SCAN_NOT_FOUND" });
    }
  } catch (err) {
    return res.status(platformStatus(err)).json(platformBody(err));
  }

  const checked = validateImageInput(res, parsed.data.imageBase64, "image/jpeg");
  if (!checked.ok) return res;
  const sourceBytes = Buffer.from(
    (checked.image.base64Part.includes(",")
      ? checked.image.base64Part.split(",")[1]
      : checked.image.base64Part
    ).trim(),
    "base64",
  );

  const store: WardrobeStore = getWardrobeStore();
  const created: unknown[] = [];
  try {
    // Idempotent confirm: selections already stored for this request are
    // skipped (same canonical), so retries never duplicate items.
    const existing = await store.findByRequest(userId, parsed.data.requestId);
    const existingNames = new Set(existing.map((i) => i.canonicalName));
    for (const sel of parsed.data.selections) {
      if (existingNames.has(sel.canonicalName)) continue;
      let item;
      try {
        item = await store.createItem({
          userId,
          canonicalName: sel.canonicalName,
          displayName: sel.displayName,
          category: sel.category,
          colors: sel.colors,
          season: sel.season,
          sourceRequestId: parsed.data.requestId,
        });
      } catch (err) {
        if (err instanceof StoreConflictError) continue;
        throw err;
      }
      const thumb = await buildThumbnail(sourceBytes);
      const path = thumbnailPath(userId, item.id);
      await store.putThumbnailBytes(path, thumb.bytes);
      try {
        const meta = await store.putImageMeta({
          itemId: item.id,
          storagePath: path,
          contentHash: thumb.sha256,
          mimeType: "image/webp",
          width: thumb.width,
          height: thumb.height,
          byteSize: thumb.bytes.length,
        });
        created.push(toStoredPayload(item, meta));
      } catch (err) {
        // Metadata write failed after bytes landed: remove the orphan bytes,
        // keep the item row (retry re-attaches). Never leave silent orphans.
        await store.removeThumbnailBytes([path]).catch(() => undefined);
        throw err;
      }
    }
  } catch (err) {
    if (err instanceof ThumbnailTooLargeError) {
      return res
        .status(413)
        .json({ error: "Не удалось подготовить миниатюру", code: "THUMBNAIL_TOO_LARGE" });
    }
    console.error(`[confirm] persist failed msg=${String(err).slice(0, 300)}`);
    return res.status(502).json({ error: "Не удалось сохранить вещи", code: "PERSIST_FAILED" });
  }
  const parsedCreated = storedItemSchema.array().safeParse(created);
  if (!parsedCreated.success) {
    return res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
  }
  return res.json({ items: parsedCreated.data });
});

function toStoredPayload(
  item: {
    id: string;
    canonicalName: string;
    displayName: string;
    category: string;
    colors: string[];
    season: string;
    status: "active" | "archived";
    createdAt: string;
  },
  meta: { width: number; height: number; byteSize: number; contentHash: string } | null,
): unknown {
  return {
    id: item.id,
    canonicalName: item.canonicalName,
    displayName: item.displayName,
    category: item.category,
    colors: item.colors,
    season: item.season,
    status: item.status,
    thumbnail: meta
      ? {
          width: meta.width,
          height: meta.height,
          byteSize: meta.byteSize,
          contentHash: meta.contentHash,
        }
      : null,
    createdAt: item.createdAt,
  };
}

// ---------- GET / (paginated grid, metadata only — never bulk bytes) ----------

router.get("/", async (req, res) => {
  if (!isPlatformIntegrationEnabled()) {
    return res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
  }
  const token = requestPlatformSession(req);
  if (!token) {
    return res
      .status(401)
      .json({ error: "Сессия истекла — войдите заново", code: "SESSION_EXPIRED" });
  }
  const client = requestPlatformClient(req);
  let userId: string;
  try {
    userId = (await client.getMe(token)).userId;
  } catch (err) {
    return res.status(platformStatus(err)).json(platformBody(err));
  }
  const rawLimit = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
  const limit = Math.min(Math.max(parseInt(String(rawLimit ?? "20"), 10) || 20, 1), 50);
  const store: WardrobeStore = getWardrobeStore();
  try {
    const items = await store.listItems(userId, limit);
    const payload = [];
    for (const item of items) {
      const meta = await store.getImageMeta(item.id);
      payload.push(toStoredPayload(item, meta));
    }
    const parsed = storedItemSchema.array().safeParse(payload);
    if (!parsed.success) {
      return res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
    }
    return res.json({ items: parsed.data });
  } catch {
    return res.status(503).json({ error: "Сервис временно недоступен", code: "STORE_UNAVAILABLE" });
  }
});

// ---------- GET /:id/image (single thumbnail bytes, ownership-checked) ----------

router.get("/:id/image", async (req, res) => {
  if (!isPlatformIntegrationEnabled()) {
    return res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
  }
  const token = requestPlatformSession(req);
  if (!token) {
    return res
      .status(401)
      .json({ error: "Сессия истекла — войдите заново", code: "SESSION_EXPIRED" });
  }
  const client = requestPlatformClient(req);
  let userId: string;
  try {
    userId = (await client.getMe(token)).userId;
  } catch (err) {
    return res.status(platformStatus(err)).json(platformBody(err));
  }
  const store: WardrobeStore = getWardrobeStore();
  try {
    const item = await store.getItem(userId, String(req.params.id));
    if (!item) return res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
    const meta = await store.getImageMeta(item.id);
    if (!meta || !meta.storagePath.startsWith(`${userId}/`)) {
      return res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
    }
    const bytes = await store.getThumbnailBytes(meta.storagePath);
    if (!bytes) return res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
    res.setHeader("Content-Type", "image/webp");
    res.setHeader("Cache-Control", "private, max-age=86400");
    return res.send(bytes);
  } catch {
    return res.status(503).json({ error: "Сервис временно недоступен", code: "STORE_UNAVAILABLE" });
  }
});

// ---------- DELETE /:id (ownership-checked, cascades bytes+meta) ----------

router.delete("/:id", async (req, res) => {
  if (!isPlatformIntegrationEnabled()) {
    return res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
  }
  const token = requestPlatformSession(req);
  if (!token) {
    return res
      .status(401)
      .json({ error: "Сессия истекла — войдите заново", code: "SESSION_EXPIRED" });
  }
  const client = requestPlatformClient(req);
  let userId: string;
  try {
    userId = (await client.getMe(token)).userId;
  } catch (err) {
    return res.status(platformStatus(err)).json(platformBody(err));
  }
  const store: WardrobeStore = getWardrobeStore();
  try {
    const deleted = await store.deleteItem(userId, String(req.params.id));
    if (!deleted) return res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
    return res.status(204).end();
  } catch {
    return res.status(503).json({ error: "Сервис временно недоступен", code: "STORE_UNAVAILABLE" });
  }
});

export default router;

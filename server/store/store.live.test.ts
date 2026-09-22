/**
 * @venvironment node
 *
 * Live Supabase round-trip (gated): items CRUD + thumbnail Storage
 * upload/download/remove + cascade + path guard, against the SHARED
 * user-platform project. Runs ONLY when SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY are set (local .env.local, never committed);
 * otherwise skips. Test rows use  owners and are deleted afterwards.
 */
import { describe, it, expect, afterAll } from "vitest";
import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import {
  StoreConflictError,
  createDurableStore,
  thumbnailPath,
  type WardrobeStore,
} from "./items.js";
import { makeThumbnail } from "./thumbnails.js";

// Local secrets for gated live tests (repo-root .env.local, gitignored).
dotenv.config({ path: ".env.local" });

const DATABASE_URL_VAL = process.env.DATABASE_URL;
const SUPABASE_URL_VAL = process.env.SUPABASE_URL;
const SERVICE_KEY_VAL = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DB_TIMEOUT = 30000;

function itLive(name: string, fn: () => Promise<void>): void {
  if (DATABASE_URL_VAL && SUPABASE_URL_VAL && SERVICE_KEY_VAL) it(name, fn, DB_TIMEOUT);
  else it.skip(name, fn);
}

let store: (WardrobeStore & { close(): Promise<void> }) | null = null;
function getStore(): WardrobeStore {
  if (!store) {
    store = createDurableStore({
      databaseUrl: DATABASE_URL_VAL as string,
      supabaseUrl: SUPABASE_URL_VAL as string,
      serviceRoleKey: SERVICE_KEY_VAL as string,
    });
  }
  return store;
}

afterAll(async () => {
  await store?.close().catch(() => undefined);
});

const created: Array<{ userId: string; itemId: string }> = [];

afterAll(async () => {
  for (const row of created.splice(0)) {
    try {
      await getStore().deleteItem(row.userId, row.itemId);
    } catch {
      // best-effort cleanup
    }
  }
});

async function realSource(): Promise<Buffer> {
  return sharp({
    create: { width: 800, height: 600, channels: 3, background: { r: 90, g: 120, b: 160 } },
  })
    .jpeg({ quality: 80 })
    .toBuffer();
}

describe("wardrobe store live (gated)", () => {
  itLive("items CRUD + idempotent source_request_id", async () => {
    const s = getStore();
    const userId = randomUUID();
    const reqId = randomUUID();
    const item = await s.createItem({
      userId,
      canonicalName: "live_jeans",
      displayName: "Live jeans",
      category: "bottom",
      colors: ["black"],
      season: "all",
      sourceRequestId: reqId,
    });
    created.push({ userId, itemId: item.id });
    await expect(
      s.createItem({
        userId,
        canonicalName: "live_jeans",
        displayName: "Live jeans",
        category: "bottom",
        colors: ["black"],
        season: "all",
        sourceRequestId: reqId,
      }),
    ).rejects.toBeInstanceOf(StoreConflictError);
    expect(await s.findByRequest(userId, reqId)).toHaveLength(1);
    expect((await s.listItems(userId, 50)).map((i) => i.id)).toContain(item.id);
    expect(await s.getItem(randomUUID(), item.id)).toBeNull();
  });

  itLive("thumbnail upload → metadata → download → cascade", async () => {
    const s = getStore();
    const userId = randomUUID();
    const item = await s.createItem({
      userId,
      canonicalName: "live_top",
      displayName: "Live top",
      category: "top",
      colors: ["white"],
      season: "summer",
      sourceRequestId: randomUUID(),
    });
    created.push({ userId, itemId: item.id });
    const thumb = await makeThumbnail(await realSource());
    const path = thumbnailPath(userId, item.id);
    await s.putThumbnailBytes(path, thumb.bytes);
    await s.putImageMeta({
      itemId: item.id,
      storagePath: path,
      contentHash: thumb.sha256,
      mimeType: "image/webp",
      width: thumb.width,
      height: thumb.height,
      byteSize: thumb.bytes.length,
    });
    const back = await s.getThumbnailBytes(path);
    expect(back?.length).toBe(thumb.bytes.length);
    expect(await s.deleteItem(userId, item.id)).toBe(true);
    created.pop();
    expect(await s.getImageMeta(item.id)).toBeNull();
    // Deletion is proven via metadata (synchronous) + bucket LISTING.
    // Content reads are NOT authoritative here: uploaded thumbnails carry
    // `cacheControl: max-age=3600`, so the CDN may serve bytes after the
    // object is gone. Production reads are metadata-gated (`/:id/image`
    // 404s without a meta row), so stale bytes are unreachable by design.
    const { createClient } = await import("@supabase/supabase-js");
    const admin = createClient(SUPABASE_URL_VAL as string, SERVICE_KEY_VAL as string, {
      auth: { persistSession: false },
    });
    const listed = await admin.storage.from("wardrobe-items").list(userId);
    expect((listed.data ?? []).map((f: { name: string }) => f.name)).not.toContain(
      `${item.id}.webp`,
    );
  });
});

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

/**
 * Wardrobe domain store (items + thumbnail metadata + bytes).
 * Owner is ALWAYS an explicit argument derived server-side from the validated
 * Platform session — never from request bodies. Paths are server-derived
 * `<user_uuid>/<item_uuid>.webp` and re-validated here (defense in depth
 * alongside the DB CHECK); browser-supplied paths are never trusted.
 */

export type ItemStatus = "active" | "archived";

export interface WardrobeItem {
  id: string;
  userId: string;
  canonicalName: string;
  displayName: string;
  category: string;
  colors: string[];
  season: string;
  status: ItemStatus;
  sourceRequestId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ItemImageMeta {
  itemId: string;
  storagePath: string;
  contentHash: string;
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
  createdAt: string;
}

export interface NewItem {
  userId: string;
  canonicalName: string;
  displayName: string;
  category: string;
  colors: string[];
  season: string;
  sourceRequestId: string | null;
}

export class StoreConflictError extends Error {
  constructor(message = "Duplicate item") {
    super(message);
    this.name = "StoreConflictError";
  }
}

export interface WardrobeStore {
  createItem(input: NewItem): Promise<WardrobeItem>;
  findByRequest(userId: string, requestId: string): Promise<WardrobeItem[]>;
  listItems(userId: string, limit: number): Promise<WardrobeItem[]>;
  getItem(userId: string, itemId: string): Promise<WardrobeItem | null>;
  deleteItem(userId: string, itemId: string): Promise<boolean>;
  putImageMeta(input: Omit<ItemImageMeta, "createdAt">): Promise<ItemImageMeta>;
  getImageMeta(itemId: string): Promise<ItemImageMeta | null>;
  putThumbnailBytes(path: string, bytes: Buffer): Promise<void>;
  getThumbnailBytes(path: string): Promise<Buffer | null>;
  removeThumbnailBytes(paths: string[]): Promise<void>;
}

const PATH_RE = /^[0-9a-fA-F-]{36}\/[0-9a-fA-F-]{36}\.webp$/;

export function assertStoragePath(path: string, userId: string): void {
  if (!PATH_RE.test(path) || !path.startsWith(`${userId}/`)) {
    throw new Error("Invalid storage path");
  }
}

export function thumbnailPath(userId: string, itemId: string): string {
  return `${userId}/${itemId}.webp`;
}

// ---------- memory fake (tests/dev; same constraint semantics) ----------

export function createMemoryStore(): WardrobeStore {
  const items = new Map<string, WardrobeItem>();
  const images = new Map<string, ItemImageMeta>();
  const blobs = new Map<string, Buffer>();
  const now = () => new Date().toISOString();

  return {
    async createItem(input) {
      for (const existing of items.values()) {
        if (
          existing.userId === input.userId &&
          input.sourceRequestId !== null &&
          existing.sourceRequestId === input.sourceRequestId &&
          existing.canonicalName === input.canonicalName
        ) {
          throw new StoreConflictError("duplicate item for request");
        }
      }
      const item: WardrobeItem = {
        id: randomUUID(),
        ...input,
        status: "active",
        createdAt: now(),
        updatedAt: now(),
      };
      items.set(item.id, item);
      return { ...item };
    },
    async findByRequest(userId, requestId) {
      return [...items.values()]
        .filter((i) => i.userId === userId && i.sourceRequestId === requestId)
        .map((i) => ({ ...i }));
    },
    async listItems(userId, limit) {
      return [...items.values()]
        .filter((i) => i.userId === userId && i.status === "active")
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .slice(0, Math.min(Math.max(limit, 1), 100))
        .map((i) => ({ ...i }));
    },
    async getItem(userId, itemId) {
      const item = items.get(itemId);
      if (!item || item.userId !== userId) return null;
      return { ...item };
    },
    async deleteItem(userId, itemId) {
      const item = items.get(itemId);
      if (!item || item.userId !== userId) return false;
      items.delete(itemId);
      const meta = images.get(itemId);
      if (meta) {
        images.delete(itemId);
        blobs.delete(meta.storagePath);
      }
      return true;
    },
    async putImageMeta(input) {
      assertStoragePath(input.storagePath, input.storagePath.split("/")[0]);
      const meta: ItemImageMeta = { ...input, createdAt: now() };
      images.set(input.itemId, meta);
      return { ...meta };
    },
    async getImageMeta(itemId) {
      const meta = images.get(itemId);
      return meta ? { ...meta } : null;
    },
    async putThumbnailBytes(path, bytes) {
      blobs.set(path, Buffer.from(bytes));
    },
    async getThumbnailBytes(path) {
      const blob = blobs.get(path);
      return blob ? Buffer.from(blob) : null;
    },
    async removeThumbnailBytes(paths) {
      for (const p of paths) blobs.delete(p);
    },
  };
}

// ---------- Durable store (production; all server-side only) ----------
//
// Tables go through DIRECT Postgres (`pg`), NOT PostgREST: the API schema
// allowlist does not expose `wardrobe.*`, and SQL keeps constraint mapping
// (unique → conflict) explicit. Thumbnail BYTES go through Supabase Storage
// (works regardless of exposed schemas).

const BUCKET = "wardrobe-items";

export interface DurableStoreOptions {
  databaseUrl: string;
  supabaseUrl: string;
  serviceRoleKey: string;
  maxConnections?: number;
}

type DbRow = Record<string, unknown>;

async function pgQuery(
  pool: Pool,
  text: string,
  params: unknown[],
): Promise<{ rows: DbRow[]; rowCount: number }> {
  try {
    const res = await pool.query(text, params as unknown[]);
    return { rows: res.rows as DbRow[], rowCount: res.rowCount ?? 0 };
  } catch (err: unknown) {
    if ((err as { code?: string }).code === "23505") {
      throw new StoreConflictError((err as Error).message);
    }
    throw err;
  }
}

export function createDurableStore(
  opts: DurableStoreOptions,
): WardrobeStore & { close(): Promise<void> } {
  const pool = new Pool({ connectionString: opts.databaseUrl, max: opts.maxConnections ?? 3 });
  const supabase = createClient(opts.supabaseUrl, opts.serviceRoleKey, {
    auth: { persistSession: false },
  });
  const storage = supabase.storage;

  function mapItem(row: Record<string, unknown>): WardrobeItem {
    return {
      id: String(row.id),
      userId: String(row.user_id),
      canonicalName: String(row.canonical_name),
      displayName: String(row.display_name),
      category: String(row.category),
      colors: (row.colors ?? []) as string[],
      season: String(row.season),
      status: row.status as ItemStatus,
      sourceRequestId: row.source_request_id === null ? null : String(row.source_request_id),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  function mapImage(row: Record<string, unknown>): ItemImageMeta {
    return {
      itemId: String(row.item_id),
      storagePath: String(row.storage_path),
      contentHash: String(row.content_hash),
      mimeType: String(row.mime_type),
      width: Number(row.width),
      height: Number(row.height),
      byteSize: Number(row.byte_size),
      createdAt: String(row.created_at),
    };
  }

  const api = {
    async createItem(input: {
      userId: string;
      canonicalName: string;
      displayName: string;
      category: string;
      colors: string[];
      season: string;
      sourceRequestId: string | null;
    }) {
      const { rows } = await pgQuery(
        pool,
        `insert into wardrobe.items
           (user_id, canonical_name, display_name, category, colors, season, source_request_id)
         values ($1, $2, $3, $4, $5, $6, $7) returning *`,
        [
          input.userId,
          input.canonicalName,
          input.displayName,
          input.category,
          input.colors,
          input.season,
          input.sourceRequestId,
        ],
      );
      return mapItem(rows[0]);
    },
    async findByRequest(userId: string, requestId: string) {
      const { rows } = await pgQuery(
        pool,
        `select * from wardrobe.items where user_id = $1 and source_request_id = $2`,
        [userId, requestId],
      );
      return rows.map(mapItem);
    },
    async listItems(userId: string, limit: number) {
      const { rows } = await pgQuery(
        pool,
        `select * from wardrobe.items where user_id = $1 and status = 'active'
         order by created_at desc limit $2`,
        [userId, Math.min(Math.max(limit, 1), 100)],
      );
      return rows.map(mapItem);
    },
    async getItem(userId: string, itemId: string) {
      const { rows } = await pgQuery(
        pool,
        `select * from wardrobe.items where id = $1 and user_id = $2`,
        [itemId, userId],
      );
      return rows.length ? mapItem(rows[0]) : null;
    },
    async deleteItem(userId: string, itemId: string) {
      const existing = await api.getItem(userId, itemId);
      if (!existing) return false;
      const meta = await api.getImageMeta(itemId);
      await pgQuery(pool, `delete from wardrobe.items where id = $1 and user_id = $2`, [
        itemId,
        userId,
      ]);
      if (meta) await api.removeThumbnailBytes([meta.storagePath]);
      return true;
    },
    async putImageMeta(input: Omit<ItemImageMeta, "createdAt">) {
      assertStoragePath(input.storagePath, input.storagePath.split("/")[0]);
      const { rows } = await pgQuery(
        pool,
        `insert into wardrobe.item_images
           (item_id, storage_path, content_hash, mime_type, width, height, byte_size)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (item_id) do update set
           storage_path = excluded.storage_path,
           content_hash = excluded.content_hash,
           mime_type = excluded.mime_type,
           width = excluded.width,
           height = excluded.height,
           byte_size = excluded.byte_size
         returning *`,
        [
          input.itemId,
          input.storagePath,
          input.contentHash,
          input.mimeType,
          input.width,
          input.height,
          input.byteSize,
        ],
      );
      return mapImage(rows[0]);
    },
    async getImageMeta(itemId: string) {
      const { rows } = await pgQuery(
        pool,
        `select * from wardrobe.item_images where item_id = $1`,
        [itemId],
      );
      return rows.length ? mapImage(rows[0]) : null;
    },
    async putThumbnailBytes(path: string, bytes: Buffer) {
      const { error } = await storage
        .from(BUCKET)
        .upload(path, bytes, { contentType: "image/webp", upsert: true });
      if (error) throw new Error(`thumbnail upload failed: ${error.message}`);
    },
    async getThumbnailBytes(path: string) {
      const { data, error } = await storage.from(BUCKET).download(path);
      if (error) return null;
      if (!data) return null;
      if (Buffer.isBuffer(data)) return data;
      const maybeBlob = data as { arrayBuffer?: unknown };
      if (typeof maybeBlob.arrayBuffer === "function") {
        return Buffer.from(await (maybeBlob.arrayBuffer as () => Promise<ArrayBuffer>)());
      }
      // Fallback: supabase-js may hand back a polyfill Blob (fetch-blob shape:
      // slice/size/type only) depending on its internal fetch stack. Fetch the
      // bytes directly with native fetch + service key instead of guessing.
      const res = await fetch(
        `${opts.supabaseUrl}/storage/v1/object/${BUCKET}/${path
          .split("/")
          .map(encodeURIComponent)
          .join("/")}`,
        { headers: { Authorization: `Bearer ${opts.serviceRoleKey}` } },
      );
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    },
    async removeThumbnailBytes(paths: string[]) {
      if (paths.length === 0) return;
      const { error } = await storage.from(BUCKET).remove(paths);
      if (error) throw new Error(`thumbnail remove failed: ${error.message}`);
    },
  };
  return {
    ...api,
    close: async () => {
      await pool.end();
    },
  };
}

// ---------- factory + test hooks ----------

let storeOverride: WardrobeStore | null = null;

export function __setWardrobeStoreForTests(store: WardrobeStore | null): void {
  storeOverride = store;
}

export function getWardrobeStore(): WardrobeStore {
  if (storeOverride) return storeOverride;
  const databaseUrl = process.env.DATABASE_URL;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (databaseUrl && url && key) {
    return createDurableStore({ databaseUrl, supabaseUrl: url, serviceRoleKey: key });
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("WARDROBE_STORE_UNAVAILABLE: DATABASE_URL/SUPABASE_* missing");
  }
  return createMemoryStore();
}

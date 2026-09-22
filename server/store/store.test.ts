/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  StoreConflictError,
  assertStoragePath,
  createMemoryStore,
  thumbnailPath,
  type WardrobeStore,
} from "./items.js";

describe("memory wardrobe store (constraint parity)", () => {
  let store: WardrobeStore;
  beforeEach(() => {
    store = createMemoryStore();
  });

  // Owner IDs are platform UUIDs in reality; path validation requires the
  // 36-char shape, so tests use UUID-shaped owners (not "user-1").
  const U1 = "11111111-1111-4111-8111-111111111111";
  const U2 = "22222222-2222-4222-8222-222222222222";
  const item = (userId: string, requestId: string | null = "req-1") => ({
    userId,
    canonicalName: "black_jeans",
    displayName: "Чёрные джинсы",
    category: "bottom",
    colors: ["black"],
    season: "all",
    sourceRequestId: requestId,
  });

  it("confirm retry with same (user, request, canonical) conflicts; list/find work", async () => {
    const user = U1;
    const created = await store.createItem(item(user, "req-1"));
    await expect(store.createItem(item(user, "req-1"))).rejects.toBeInstanceOf(StoreConflictError);
    // Different canonical, same request: allowed (multi-garment photo).
    await store.createItem({ ...item(user, "req-1"), canonicalName: "white_tshirt" });
    expect(await store.findByRequest(user, "req-1")).toHaveLength(2);
    expect(await store.listItems(user, 50)).toHaveLength(2);
    expect(await store.getItem(user, created.id)).toMatchObject({ canonicalName: "black_jeans" });
  });

  it("ownership isolation: foreign user sees nothing, deletes nothing", async () => {
    const created = await store.createItem(item(U1, "r1"));
    expect(await store.getItem(U2, created.id)).toBeNull();
    expect(await store.deleteItem(U2, created.id)).toBe(false);
    expect(await store.getItem(U1, created.id)).not.toBeNull();
    expect(await store.deleteItem(U1, created.id)).toBe(true);
    expect(await store.listItems(U1, 50)).toHaveLength(0);
  });

  it("delete cascades thumbnail bytes + metadata", async () => {
    const created = await store.createItem(item(U1, "r2"));
    const path = thumbnailPath(U1, created.id);
    await store.putThumbnailBytes(path, Buffer.from([1, 2, 3]));
    await store.putImageMeta({
      itemId: created.id,
      storagePath: path,
      contentHash: "abc",
      mimeType: "image/webp",
      width: 100,
      height: 100,
      byteSize: 3,
    });
    await store.deleteItem(U1, created.id);
    expect(await store.getImageMeta(created.id)).toBeNull();
    expect(await store.getThumbnailBytes(path)).toBeNull();
  });

  it("storage paths are validated (user prefix + uuid shape)", async () => {
    expect(() => assertStoragePath("../../etc/passwd", U1)).toThrow();
    expect(() =>
      assertStoragePath(
        "33333333-3333-4333-8333-333333333333/123e4567-e89b-12d3-a456-426614174000.webp",
        U1,
      ),
    ).toThrow();
    expect(() =>
      assertStoragePath(`${U1}/123e4567-e89b-12d3-a456-426614174000.webp`, U1),
    ).not.toThrow();
    await expect(
      store.putImageMeta({
        itemId: "x",
        storagePath: "evil",
        contentHash: "h",
        mimeType: "image/webp",
        width: 1,
        height: 1,
        byteSize: 1,
      }),
    ).rejects.toThrow();
  });
});

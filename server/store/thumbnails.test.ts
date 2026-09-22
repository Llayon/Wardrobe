/**
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { ThumbnailTooLargeError, makeThumbnail } from "./thumbnails.js";

/** Real decodable source (800×600 solid) for the sharp pipeline. */
async function realSource(): Promise<Buffer> {
  return sharp({
    create: { width: 800, height: 600, channels: 3, background: { r: 30, g: 60, b: 120 } },
  })
    .jpeg({ quality: 85 })
    .toBuffer();
}

describe("thumbnail pipeline", () => {
  it("crops bbox → webp ≤200KB, strips metadata, hashes", async () => {
    const thumb = await makeThumbnail(await realSource(), { x: 0.1, y: 0.1, w: 0.5, h: 0.5 });
    expect(thumb.bytes.length).toBeLessThanOrEqual(200 * 1024);
    // Flat sources legitimately compress tiny — bound is positivity + cap.
    expect(thumb.bytes.length).toBeGreaterThan(0);
    expect(thumb.width).toBeLessThanOrEqual(512);
    expect(thumb.height).toBeLessThanOrEqual(512);
    expect(thumb.sha256).toMatch(/^[0-9a-f]{64}$/);
    const meta = await sharp(thumb.bytes).metadata();
    expect(meta.format).toBe("webp");
    // No EXIF/GPS survives re-encode (we never call withMetadata()).
    expect(meta.exif).toBeUndefined();
  });

  it("falls back to center square without bbox", async () => {
    const thumb = await makeThumbnail(await realSource());
    expect(thumb.width).toBe(thumb.height);
  });

  it("undecodable input throws (never persists garbage)", async () => {
    await expect(makeThumbnail(Buffer.from([1, 2, 3, 4]))).rejects.toThrow();
    expect(ThumbnailTooLargeError).toBeDefined();
  });
});

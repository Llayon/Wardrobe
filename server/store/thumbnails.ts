import crypto from "node:crypto";
import sharp from "sharp";

/**
 * Thumbnail pipeline (binding per W-003/W-007 correction).
 * Source bytes (transient) → crop (`bbox` hint or center square) → max 512px
 * → WebP (metadata stripped by construction: sharp drops EXIF unless
 * `withMetadata()` is called, which we never do) → ~50–150 KB target.
 */

export interface Thumbnail {
  bytes: Buffer;
  width: number;
  height: number;
  sha256: string;
}

export class ThumbnailTooLargeError extends Error {
  constructor() {
    super("Thumbnail exceeds storage bound");
    this.name = "ThumbnailTooLargeError";
  }
}

const MAX_SIDE = 512;
const BYTE_BOUND = 200 * 1024;

export async function makeThumbnail(
  sourceBytes: Buffer,
  bbox?: { x: number; y: number; w: number; h: number },
): Promise<Thumbnail> {
  const meta = await sharp(sourceBytes).metadata();
  const srcW = meta.width ?? 0;
  const srcH = meta.height ?? 0;
  if (!srcW || !srcH) throw new Error("Undecodable image for thumbnail");

  let left = 0;
  let top = 0;
  let size = Math.min(srcW, srcH);
  if (bbox) {
    const bx = Math.max(0, Math.floor(bbox.x * srcW));
    const by = Math.max(0, Math.floor(bbox.y * srcH));
    const bw = Math.min(srcW - bx, Math.floor(bbox.w * srcW));
    const bh = Math.min(srcH - by, Math.floor(bbox.h * srcH));
    if (bw >= 32 && bh >= 32) {
      left = bx;
      top = by;
      size = bw;
      // Square crop centered on the bbox center for uniform grid tiles.
      const side = Math.min(bw, bh);
      left = bx + Math.floor((bw - side) / 2);
      top = by + Math.floor((bh - side) / 2);
      size = side;
    }
  } else {
    left = Math.floor((srcW - size) / 2);
    top = Math.floor((srcH - size) / 2);
  }

  for (const quality of [78, 60]) {
    const out = await sharp(sourceBytes)
      .extract({ left, top, width: size, height: size })
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
      .webp({ quality })
      .toBuffer();
    if (out.length <= BYTE_BOUND) {
      const info = await sharp(out).metadata();
      return {
        bytes: out,
        width: info.width ?? 0,
        height: info.height ?? 0,
        sha256: crypto.createHash("sha256").update(out).digest("hex"),
      };
    }
  }
  throw new ThumbnailTooLargeError();
}

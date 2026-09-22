import { z } from "zod";

// ---------- item ontology (see docs/ONTOLOGY.md) ----------

export const categorySchema = z.enum(["outerwear", "top", "bottom", "dress", "shoes", "accessory"]);
export type Category = z.infer<typeof categorySchema>;

export const colorSchema = z.enum([
  "black",
  "white",
  "gray",
  "beige",
  "brown",
  "navy",
  "blue",
  "red",
  "green",
  "yellow",
  "orange",
  "pink",
  "purple",
  "multicolor",
  "metallic",
]);

export const seasonSchema = z.enum(["all", "summer", "demi", "winter"]);

// ---------- vision contract (wardrobe.scan) ----------

export const bboxSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0.01).max(1),
  h: z.number().min(0.01).max(1),
});

export const candidateItemSchema = z.object({
  canonicalName: z.string().min(1).max(64),
  displayName: z.string().min(1).max(64),
  category: categorySchema,
  colors: z.array(colorSchema).max(2).default([]),
  confidence: z.number().min(0).max(1),
  bbox: bboxSchema.optional(),
});

export const uncertainGarmentSchema = z.object({
  canonicalName: z.string().min(1).max(64),
  displayName: z.string().min(1).max(64),
  reason: z.string().max(200).optional(),
});

export const wardrobeScanSchema = z.object({
  items: z.array(candidateItemSchema).min(0).max(12),
  uncertainItems: z.array(uncertainGarmentSchema).min(0).max(10),
});
export type WardrobeScan = z.infer<typeof wardrobeScanSchema>;

// ---------- API contracts ----------

export const scanRequestSchema = z.object({
  imageBase64: z.string().min(10).describe("Base64 image data, with or without data: prefix"),
  mimeType: z.string().optional().default("image/jpeg"),
  // Client idempotency key: one UUID per deliberate scan action (mandatory
  // in authenticated mode, never server-invented).
  requestId: z.string().uuid().optional(),
});

const confirmedItemSchema = z.object({
  canonicalName: z.string().min(1).max(64),
  displayName: z.string().min(1).max(64),
  category: categorySchema,
  colors: z.array(colorSchema).max(2).default([]),
  season: seasonSchema.default("all"),
});

export const confirmRequestSchema = z.object({
  // SAME scan UUID the candidates came from (idempotent confirm retry).
  requestId: z.string().uuid(),
  // Source image re-sent (sources stay transient server-side by design).
  imageBase64: z.string().min(10),
  selections: z.array(confirmedItemSchema).min(0).max(12),
});

export const storedItemSchema = z.object({
  id: z.string().uuid(),
  canonicalName: z.string(),
  displayName: z.string(),
  category: categorySchema,
  colors: z.array(z.string()),
  season: seasonSchema,
  status: z.enum(["active", "archived"]),
  thumbnail: z
    .object({
      width: z.number(),
      height: z.number(),
      byteSize: z.number(),
      contentHash: z.string(),
    })
    .nullable(),
  createdAt: z.string(),
});
export type StoredItem = z.infer<typeof storedItemSchema>;

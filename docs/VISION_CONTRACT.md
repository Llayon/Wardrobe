# Vision Contract (Gauntlet 0 — proposal)

## Scan (`wardrobe.scan`, 1 credit per deliberate photo)

Request: `{ imageBase64, mimeType, requestId (uuid, mandatory in auth mode) }`.
Photo guidance: 2–8 garments, flat lay or hanger, good light. Validation
(payload/size ≤300 KB/mime) runs BEFORE reserve (0 credits on failure).

Vision result (structured, provider-agnostic):

```json
{
  "items": [
    {
      "canonicalName": "black_jeans",
      "displayName": "Чёрные джинсы",
      "category": "bottom",
      "colors": ["black"],
      "confidence": 0.9,
      "bbox": { "x": 0.1, "y": 0.2, "w": 0.3, "h": 0.5 }
    }
  ],
  "uncertainItems": [{ "canonicalName": "...", "displayName": "...", "reason": "..." }]
}
```

- `bbox` (normalized 0..1) is the thumbnail crop hint; absent → center-square.
- Empty-but-valid result is a completed paid scan (same policy as NO_FOOD).
- Technical failure (timeout/429/5xx/malformed) → release, balance whole.

## Confirm (no credits — persistence only)

Request: `{ requestId (SAME scan uuid), selections: [{…edited fields…}] }`.
Server: verifies the scan reservation settled (same `requestId`), crops +
re-encodes thumbnails (WebP, metadata stripped, 50–150 KB), inserts items
with `source_request_id` uniqueness (confirm retry is idempotent — no dupes).
Response: created items with thumbnail metadata (bytes served as base64 on
reads, never public URLs in MVP).

## Grid (no credits — local reads)

`GET /api/items` → active items with thumbnails, newest first, paginated
(default limit 50 — a 100-item wardrobe at ~200 KB base64 per thumbnail must
never serialize into one 20 MB response). Reads never touch UserPlatform.
Delete → cascade thumbnails (hard delete in MVP; archive flag reserved).

## Outfits, next gauntlet (sketch)

Request `{ occasion, season? }` → reserve `wardrobe.outfit` → generate
EXACTLY 3 outfits from active item IDs only → commit → save selected.
Same settlement-replay and idempotency shape as scans.

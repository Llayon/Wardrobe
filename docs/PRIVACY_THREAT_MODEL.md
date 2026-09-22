# Privacy + Threat Model (Gauntlet 0)

## Image lifecycle (binding)

- Source/group photos: request memory only → vision → discard. Never disk,
  DB, cache, logs, or GitHub. Same guarantee as Holodilnik, same tests.
- Thumbnails: cropped per `bbox`, re-encoded WebP, ALL metadata stripped
  (EXIF/GPS), 50–150 KB. Persisted ONLY after explicit user confirm.
- Cache keys: SHA-256(image bytes) → structured result (never bytes).
- Logs: request IDs, provider, latency, settlement outcomes. Never initData,
  tokens, raw identifiers, image bytes, or user IDs beyond hashes.

## Thumbnail access control

- Served ONLY through authenticated `/api/items/*` as base64 in JSON (no
  public/signed URLs in MVP — no expirable-link infrastructure to get wrong).
- Every read/write/delete re-derives owner from the validated session;
  item IDs are opaque UUIDs, ownership checked per query (cross-user IDOR
  tests mandatory in Gauntlet 2).
- Delete cascades thumbnails; no soft-delete retention in MVP.

## Threats (critic must attack these in Gauntlets 1–2)

- Forged/foreign session on items routes → 401/403, no data.
- Cross-user item UUID swap in confirm/read/delete → 404, no leak.
- `wardrobe.outfit`/`wardrobe.scan` called with a fridge credential or
  session (and vice versa) → 403 by UserPlatform scoping (integration tests
  with two synthetic apps, Holodilnik pattern).
- Oversized/malicious uploads → 413/400 before reserve and before persist.
- AI output with hostile display names → stored verbatim but rendered
  escaped (React default); length-capped by contract.
- Account deletion (future): cascade must remove items + thumbnails; until
  implemented, document retention explicitly — do NOT silently retain.

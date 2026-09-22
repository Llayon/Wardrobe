# DECISIONS.md — Wardrobe Architecture Records

## W-001: Shared Telegram bot for the MVP (option a)

- **Decision:** Wardrobe ships as a second named Mini App under the existing
  `@holodilnikmegabot` (own `short_name`, e.g. `t.me/holodilnikmegabot/wardrobe`).
  Telegram officially supports multiple named Mini Apps per bot; the existing
  `TELEGRAM_BOT_TOKEN` validation in UserPlatform remains valid unchanged.
- **Context:** `initData` is signed per-bot. A separate wardrobe bot would
  require per-app bot tokens in UserPlatform — an auth redesign the frozen
  baseline explicitly forbids without a proven blocker. App isolation already
  comes from per-app service credentials + app-scoped sessions, never from
  bot separation.
- **Consequence:** No UserPlatform change in MVP. Separate-bot support is
  recorded as a future branding/architecture decision only.

## W-002: New repository, mirrored stack, reused patterns (strategy D)

- **Decision:** `Llayon/Wardrobe` (public), React 19 + Vite 8 + Express 5 +
  Zod 4 + Vitest + Playwright, Vercel deployment, `server/api` dual-mount
  entrypoints — mirrored from Holodilnik. UserPlatform is consumed through a
  small local typed HTTP adapter (same strategy D as Holodilnik ADR-042):
  no npm dependency on `@user-platform/*`, no sibling-filesystem imports.
- **Context:** Holodilnik Gauntlet 2 proved the pattern end-to-end
  (10→9→9 live). Copying pattern files as a starting template is allowed;
  importing across repos in production is not.
- **Consequence:** Independent deploys, independent envs, identical authority
  shape (`SERVICE APP == SESSION APP == OPERATION APP`).

## W-003: Image lifecycle — transient sources, persistent thumbnails (correction)

- **Decision:** Source/group camera photos are transient (request memory only,
  never persisted, same as Holodilnik). Per-item thumbnails PERSIST:
  server-side crop (vision `bbox` hint, fallback center-square), re-encode
  WebP, strip ALL metadata (EXIF/GPS), target 50–150 KB/item, stored in
  `wardrobe.item_images` keyed by item, cascade-deleted with the item.
- **Context:** Wardrobe is visual-persistent by product definition: users must
  recognize their clothes in the grid and (later) in outfits. A pure-transient
  design would make the product unusable; full-original persistence would be
  a privacy/cost liability.
- **Consequence:** Structured descriptors + thumbnails are the persisted unit;
  originals never hit disk/DB/logs. See `docs/PRIVACY_THREAT_MODEL.md`.

## W-004: Dedicated `wardrobe.*` schema on shared Supabase infrastructure

- **Decision:** Same Supabase project (`user-platform`, linked this pass —
  remote shows the 4 platform migrations, local draft pending, no collision),
  new schema `wardrobe.*` owned by this repo's migrations:
  `wardrobe.items` now; `wardrobe.outfits` (+join) in the outfits gauntlet.
  Owner column = platform internal UUID as plain `uuid` with NO database FK
  to platform tables (portability); authorization is application-side from
  the validated session on every query.
- **Context:** Operator decision 4 forbids Wardrobe tables in UserPlatform
  migrations and DB-level coupling. RLS deny-by-default mirrors the platform
  posture; API uses service-role server-side only.
- **Consequence:** `supabase/migrations/20260922000000_wardrobe_items.sql`
  - `20260922xxxxxx_wardrobe_storage.sql` (DRAFT, unapplied).

## W-007: Thumbnails in private Supabase Storage, metadata in Postgres (amends W-004)

- **Decision:** Item thumbnails persist in a dedicated PRIVATE bucket
  `wardrobe-items` (never public; no permissive storage policies for it —
  service-role bypasses RLS server-side, anon/authenticated get nothing).
  Postgres keeps metadata only (`item_id`, `storage_path`, `content_hash`,
  `mime_type`, `width`, `height`, `byte_size`). Path shape
  `<user_uuid>/<item_uuid>.webp` enforced BOTH by a DB CHECK constraint and
  server-side derivation from the validated session (browser-supplied paths
  never trusted). Served to browsers as base64 via authenticated API (no
  signed public URLs in MVP).
- **Context:** Operator correction to Gauntlet 0 storage: bytea-in-Postgres
  rejected for the first real slice; Storage from day one. Keeps rows small,
  thumbnails CDN-capable later, same privacy posture (private bucket).
- **Consequence:** Migration `0001` carries `items` only; `0002` creates the
  bucket (+limits: 200 KB, `image/webp` only) and the metadata table. New
  runtime deps for Phase 2: `@supabase/supabase-js` (service-role server
  only) + `sharp` (crop/re-encode/strip), `SUPABASE_URL` /
  `SUPABASE_SERVICE_ROLE_KEY` server envs.

## W-005: Credit policy (registry as-is, shopping_check excluded)

- **Decision:** One deliberate item photo (`wardrobe.scan`) = 1 credit,
  regardless of garments found (0–8+); same-requestId retry never recharges;
  confident "no clothes" from a successful analysis is a completed scan
  (mirrors Holodilnik NO_FOOD). `wardrobe.outfit` = 1 per 3-look generation
  (next gauntlet). `wardrobe.shopping_check` is never called in MVP although
  the registry row exists and stays enabled.
- **Context:** Credits price product usage, not provider cost (proven policy).
  Grid reads are local DB (no platform calls, no credits) — credits gate AI
  operations only.
- **Consequence:** Scan pipeline is reserve-before-AI with settlement replay,
  copied from the Holodilnik shape. See `docs/COST_RATE_LIMITS.md`.

## W-006: MVP stops at the wardrobe grid (outfits next)

- **Decision:** First vertical slice: auth → add clothes (2–8 garments/photo
  → AI candidates → confirm/edit) → persistent items + thumbnails → grid.
  Outfit generation (occasion → exactly 3 looks from existing IDs → save) is
  explicitly the NEXT gauntlet, with its schema (`outfits`, `outfit_items`)
  drafted but not migrated here.
- **Context:** Decision 6 scope. Shipping storage + confirmation UX before
  generation keeps each gauntlet verifiable (grid contents are assertable
  without judging generative taste).
- **Consequence:** No `/api/outfits/*`, no outfit UI, no outfit credit path
  in this MVP slice's implementation phases.

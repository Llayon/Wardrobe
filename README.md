# Wardrobe — AI wardrobe Mini App on shared UserPlatform

Digital wardrobe: photograph clothes → confirm recognized garments → browse
your wardrobe → generate exactly 3 outfits from existing items only.

## Status

Gauntlet 0 (discovery + architecture). See `.gauntlet/STATE.md`.

## Identity and credits (do not reimplement)

- Accounts, sessions, credits, and the operation registry live in
  **UserPlatform** (`Llayon/UserPlatform`, frozen at `18f37a5`).
- Wardrobe authenticates through the proven Holodilnik pattern
  (`Llayon/Holodilnik` reference only, frozen prod baseline in its STATE.md):
  Telegram identity → service-authenticated exchange → app-scoped session in
  a first-party HttpOnly cookie → `SERVICE APP == SESSION APP == OPERATION APP`.
- Costs: `wardrobe.scan = 1` per deliberate item photo,
  `wardrobe.outfit = 1` per 3-look generation. `wardrobe.shopping_check` is
  NOT used in MVP.

## Layout (planned)

- `server/` — Express API (platform bridge, items, outfits, providers)
- `src/` — React client (upload, confirm, wardrobe grid; outfits later)
- `shared/` — Zod contracts (item ontology, vision/result shapes)
- `supabase/migrations/` — `wardrobe.*` schema only (never UserPlatform tables)
- `docs/` — architecture, ontology, vision contract, privacy/threat model
- `.gauntlet/` — STATE / DECISIONS / FAILURES / CRITIC

## Rules (inherited from the frozen baseline)

- No filesystem/runtime dependency on sibling repositories.
- Service secrets server-only (`USER_PLATFORM_SERVICE_TOKEN`, no `VITE_*`).
- Source/group photos transient; item thumbnails persist normalized
  (WebP ~50–150 KB, metadata stripped, owner = platform user UUID).
- Gauntlet mode: BUILDER → CRITIC → FIXER → VERIFY per phase.

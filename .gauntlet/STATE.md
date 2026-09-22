# STATE.md — Wardrobe Checkpoint

## Current Checkpoint: GAUNTLET 0 — DISCOVERY + ARCHITECTURE (IN PROGRESS)

**Date:** 2026-09-22
**Repository:** `Llayon/Wardrobe` (public, created this pass via `gh repo create`)
**Branch:** main (GitHub default; Holodilnik/UserPlatform use master — Wardrobe
starts on default `main`, no reason to diverge from the default)
**Local path:** `D:\Programms\Max\Wardrobe`

### Frozen references (do not modify)

- UserPlatform `18f37a5` (Service Bridge READY, prod healthy,
  `https://user-platform-phi.vercel.app`)
- Holodilnik prod baseline: see its `.gauntlet/STATE.md`
  ("FROZEN PRODUCTION BASELINE", `6aa2ced`+docs) — reference only

### Operator decisions for Gauntlet 0 (binding)

1. **Shared bot (a):** `@holodilnikmegabot` hosts Wardrobe as a second named
   Mini App (`t.me/holodilnikmegabot/wardrobe`). No UserPlatform auth change.
2. **New repo** `Llayon/Wardrobe` (this one). Nothing inside Holodilnik/UserPlatform.
3. **Image lifecycle correction:** source/group photos transient; per-item
   thumbnails PERSIST (normalized WebP ~50–150 KB, metadata stripped, owner =
   platform user UUID) + structured descriptors.
4. **Durable store:** same Supabase/PostgreSQL infrastructure, dedicated
   `wardrobe.*` schema owned here (`items`, `item_images`; outfits next
   gauntlet). No Wardrobe tables in UserPlatform migrations. No DB-level FK
   to platform tables; authorization application-side from the session.
5. **UserPlatform frozen:** `wardrobe.scan = 1`, `wardrobe.outfit = 1`;
   `wardrobe.shopping_check` NOT used in MVP.
6. **MVP slice:** auth → add clothes (photo with 2–8 garments → AI candidates
   → confirm/edit) → persistent items + thumbnails → wardrobe grid. STOP.
   Outfits are the NEXT gauntlet.
7. **Stack mirror:** React/Vite/TS/Express/Vercel/Zod/Vitest/Playwright;
   patterns reused, domain code not copied.

### Gauntlet 0 deliverables (this pass)

- `docs/ARCHITECTURE.md` — end-to-end integration architecture
- `docs/ONTOLOGY.md` — item ontology proposal (categories, colors, seasons)
- `docs/VISION_CONTRACT.md` — scan/confirm/grid contract (outfits sketched)
- `docs/PRIVACY_THREAT_MODEL.md` — privacy + threat model
- `docs/COST_RATE_LIMITS.md` — cost policy, rate limits, testing strategy
- `supabase/migrations/0001_wardrobe_items.sql` — DRAFT, unapplied
- `.gauntlet/DECISIONS.md` (W-001…), `.gauntlet/CRITIC.md` (Phase 0 pass),
  `.gauntlet/FAILURES.md` (seeded with inherited tooling lessons)

### Hard stop

WARDROBE GAUNTLET 0 READY — then report the proposed Phase 1/2 plan.
No scan feature implementation until architectural critic is green.

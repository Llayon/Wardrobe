# STATE.md — Wardrobe Checkpoint

## Current Checkpoint: WARDROBE GAUNTLET 0 READY

**Date:** 2026-09-22
**Repository:** `Llayon/Wardrobe` (public, created this pass via `gh repo create`)
**Branch:** main @ `dec0172` (pushed, clean; repo-local builder identity,
same convention as siblings)
**Local path:** `D:\Programms\Max\Wardrobe`

Gates: format ✅ · lint (0 errors) · typecheck ✅ · unit 2/2 ✅ · build ✅ ·
secret scan clean (placeholders only) · critic C-001/C-002 closed, no open
BLOCKER/P1. E2E harness configured, first specs land in Gauntlet 1.
Supabase link + `db push` validation deferred to Gauntlet 1 (migration DRAFT).

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

---

## Phase 1–2 implementation status (2026-09-22, code complete, infra partial)

- Phase 1 critic C-101 closed; 12/12 E2E. Phase 2 critic C-201/C-202/C-203
  closed; billing/ownership/thumbnail suites green (see CRITIC.md).
- Live store suites green against shared Supabase (tables + Storage
  round-trip + cascade; F-002 recorded).
- Migrations `20260922000000/1` APPLIED remotely (6/6 local == remote).
- Vercel project `wardrobe-app` created; stable alias
  `https://wardrobe-smoke.vercel.app` → latest Preview (re-alias per deploy).
- Preview env present: service token (pipe-installed, never displayed),
  `USER_PLATFORM_URL`, flag true, `SUPABASE_URL` + service key (pipe),
  `DATABASE_URL` (pipe). Credential `c576cf…` active; stillborns revoked.
- STILL NEEDED (operator dashboard, values never in chat): KV/Upstash
  connection for `wardrobe-app`, `ZAI_API_KEY` + `GROQ_API_KEY` (Preview),
  Preview protection exception (or temporary disable) for the smoke alias,
  second BotFather Mini App (`wardrobe` short_name) → smoke alias.
- Without AI keys, Preview runs mock vision; without Redis, scans 503
  (fail-closed); store path is live.

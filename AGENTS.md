# AGENTS.md — Wardrobe

## Project: Wardrobe (Mobile-first AI wardrobe Mini App)

second Telegram Mini App under the existing `@holodilnikmegabot`
(own `short_name`, e.g. `t.me/holodilnikmegabot/wardrobe`). Same
`TELEGRAM_BOT_TOKEN` validation in UserPlatform stays valid; app isolation
comes from per-app service credentials, never from bot separation.

### Stack (mirrors proven Holodilnik foundation)

- Node 24+, React 19, Vite 8, TypeScript strict
- Express 5, Zod 4, Vitest 3, Playwright 1.55, ESLint 9, Prettier 3
- Supabase/PostgreSQL (`wardrobe.*` schema owned here), Upstash Redis
  (abuse limits only)

### Architecture

```
Telegram (shared bot, own short_name) → Wardrobe backend
  → UserPlatform (service credential, app=wardrobe)
  → app-scoped session (own HttpOnly cookie)
  → wardrobe.scan (1) / wardrobe.outfit (1) → shared wallet
```

- Never expose service credential to client. No `VITE_USER_PLATFORM_*`.
- Client calls `/api/platform/*` (auth), `/api/items/*` (scan/confirm/grid),
  `/api/outfits/*` (later phase).
- Server validates with Zod; images ≤300 KB decoded (same ceiling as fridge).

### Providers

- Vision chain pattern reused: primary → fallback, one call each max.
  Exact models pinned in Gauntlet 2 (start from ZAI → Groq, benchmark first).
- Mock providers for tests/E2E (deterministic, no quota).

### Domain storage (unlike Holodilnik, Wardrobe is stateful)

- `wardrobe.items` + `wardrobe.item_images` (thumbnails persist, see docs).
- Owner = UserPlatform internal UUID (from validated session, never body).
- No DB-level FK to platform tables (portability); authorization is
  application-side from the session.

### Tests

- Unit: contracts, providers (mock), platform adapter (mock), settlement.
- E2E: Playwright, system Chrome, mock platform + mock vision personas.

### Scripts

- `npm run dev` / `build` / `lint` / `format:check` / `typecheck` / `test` /
  `test:e2e` (wired in Gauntlet 1; Phase 0 repo has docs + schema only)

### For Next Agent

- See `.gauntlet/STATE.md` for current checkpoint
- See `.gauntlet/DECISIONS.md` for ADRs (W-001…)
- See `.gauntlet/FAILURES.md` for known issues
- Frozen references: UserPlatform `18f37a5`, Holodilnik prod baseline in its
  `.gauntlet/STATE.md` ("FROZEN PRODUCTION BASELINE")

# Wardrobe Architecture (Gauntlet 0)

## End-to-end flow (MVP slice)

```
Telegram (@holodilnikmegabot/wardrobe)
  → Wardrobe frontend (host adapter → raw initData)
  → POST /api/platform/exchange (Wardrobe backend)
  → UserPlatform service exchange (wardrobe credential)
  → app-scoped wardrobe session → own HttpOnly cookie (wardrobe_session)
  → POST /api/items/scan { image, requestId }
  → validate → session → reserve wardrobe.scan (1)
  → vision (primary → fallback) → candidate garments
  → POST /api/items/confirm { selections/edits, requestId }
  → persist items + thumbnails → wardrobe grid (local reads, no credits)
```

Recipes-analog (outfits) arrives next gauntlet over the same rails with
`wardrobe.outfit`.

## Backend modules (planned, Gauntlet 1–2)

- `server/platform/` — typed UserPlatform client, mock, cookies
  (`wardrobe_session`), settlement cache (copied pattern, wardrobe scope)
- `server/routes/platform.ts` — exchange / me / session / dev-only hooks
- `server/routes/items.ts` — scan (credit-aware) / confirm / list / delete
- `server/vision/` — provider chain + mock (wardrobe prompts, own versions)
- `server/store/` — `wardrobe.*` repositories (pg + memory fakes)
- `server/rateLimit.ts` — anonymous 5/20 + auth 30/200, hashed keys

## Frontend modules (planned)

- `src/lib/host.ts` — single bridge boundary (Telegram → hash → MAX → web)
- `src/lib/platform.ts` — auth states, balance, plurals
- Upload (2–8 garments guidance) → candidates confirm/edit → grid with
  thumbnails → (later) occasion picker → 3 looks → save

## Data ownership

| Layer            | Owner        | Store           |
| ---------------- | ------------ | --------------- |
| identity/session | UserPlatform | platform tables |
| credits/ledger   | UserPlatform | wallet + ledger |
| items/thumbnails | Wardrobe     | `wardrobe.*`    |
| anonymous abuse  | Wardrobe     | Redis counters  |

Wardrobe never writes platform tables; UserPlatform never reads wardrobe
tables. The join key is the internal user UUID carried server-side only.

## Deployment

Vercel project `wardrobe` (new), Preview alias for staging smoke from day
one (`wardrobe-smoke` pattern), Production later with the same flag-gated
rollout Holodilnik proved (code with flag false → legacy → enable → smoke).
Telegram bot URL switches to Production only at rollout.

# Cost Policy, Rate Limits, Testing Strategy (Gauntlet 0)

## Cost policy (registry: `wardrobe.scan = 1`, `wardrobe.outfit = 1`)

- One deliberate item photo = 1 `wardrobe.scan`, regardless of garments
  found (0–8+). Same-requestId retry never recharges. Confident "no
  clothes" from a successful analysis is completed (paid).
- Confirm/grid/delete cost 0 (local persistence/reads, no AI).
- One 3-look generation = 1 `wardrobe.outfit` (next gauntlet).
- `wardrobe.shopping_check` never called in MVP.
- Pipeline order enforced: validate → session → requestId → abuse check →
  reserve → AI → commit/release (never AI before reserve).

## Rate limits (mirror Holodilnik, wardrobe scope)

- Anonymous: vision 5/device/day + 20/IP/day (same Redis store pattern).
- Authenticated: abuse caps 30/user/day + 200/IP/day
  (`rate:auth:vision:*`, SHA-256 user-UUID keys); credits are the business
  entitlement. Redis fail-closed in production, unchanged semantics.
- Grid/confirm/delete: no AI, no platform calls — rate-limit reads only if
  abuse appears (deferred, documented).

## Testing strategy

- Unit (no quota, no network): contracts (ontology/vision zod), mock vision
  (deterministic garments), mock platform (same idempotency shape as
  Holodilnik mock), memory store fakes with identical constraint semantics.
- `DATABASE_URL`-gated live tests: migration applies cleanly, RLS denies
  anon, cascade delete works, `itest-` rows cleaned.
- E2E (Playwright, system Chrome, mock platform + mock vision): anonymous
  web, authenticated Telegram mock (10 → scan → 9), zero-credits, outage
  retry, mobile 360/390/430 overflow-free. No real host SDK in CI.
- Live gates: one controlled Telegram smoke per gauntlet max
  (10 → 9 → 9 pattern), Preview alias staging from day one.

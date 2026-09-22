# CRITIC.md — Wardrobe adversarial review log

## Gauntlet 0 critic pass — discovery + architecture (2026-09-22, CLOSED)

Critic reviewed all Gauntlet 0 artifacts (STATE, W-001…W-006, five docs
proposals, draft migration, repo skeleton) for scope discipline, privacy
holes, and anything that would break Gauntlets 1–2.

### C-001 [P1] Migration filename broke CLI convention — FIXED

- **Attack:** `0001_wardrobe_items.sql` sorts outside the Supabase CLI
  timestamp convention every other repo here uses; future `migration list`
  / ordering gets confusing the moment a second file lands.
- **Fix:** renamed to `20260922000000_wardrobe_items.sql`.
- **Status:** resolved.

### C-002 [P1] Unpaginated grid = 20 MB response footgun — FIXED (contract)

- **Attack:** 100 wardrobe items × ~150 KB thumbnails as inline base64 in
  one `GET /api/items` = ~20 MB JSON, Vercel function timeouts + client OOM
  on phones. The proposal said "newest first" with no bound.
- **Fix:** contract pins default limit 50 (pagination required in Gauntlet 2
  implementation, with a test asserting the bound).
- **Status:** resolved as a binding contract constraint.

### Reviewed and accepted (no change)

- Shared-bot (a): initData namespace is `provider+id`, app isolation is
  credential/session/operation-scoped — one bot cannot cross wardrobe/fridge
  authority. Separate-bot stays a branding-only future item.
- `UNIQUE(user_id, source_request_id)` with NULLs: Postgres treats NULLs as
  distinct, so request-less items never collide while confirm-retry stays
  idempotent. Deliberate, correct.
- No DB FK to platform tables: blast radius of a platform schema change is
  zero on the wardrobe side; ownership checks are per-query from the session
  (IDOR tests gated to Gauntlet 2).
- Bytea thumbnails (TOAST) fit MVP scale; Storage-bucket escape hatch is
  documented with an explicit revisit trigger (~10k items), not built now.
- Vision provider choice (ZAI→Groq starting hypothesis) deliberately
  deferred to Gauntlet 2 benchmark — pinning models without measurements
  would repeat old mistakes, not avoid them.
- `wardrobe.shopping_check` stays called-by-nobody: registry row exists,
  MVP never spends it. No dead code, no contract to maintain.
- Supabase project link + `db push` validation deferred to Gauntlet 1
  (same checkpoint pattern as the other repos); migration stays DRAFT and
  UNAPPLIED until then.

No open BLOCKER or P1. Gauntlet 0 may commit.

## Phase 1 critic pass — platform integration (2026-09-22, CLOSED)

- **C-101 [BLOCKER] E2E faked the bridge wrong:** all bridge E2E failed
  anonymous while backend+units were green — the real CDN script clobbered
  `addInitScript` fakes (F-001). FIXED: abort the script when faking the
  bridge; separate WebK hash-path test. 12/12 green after.
- **Attacked and repelled (mock + routes + E2E):** shared-store cross-app
  matrix (fridge cred/session vs wardrobe ops and back → 403 both ways;
  same-user commit/release across apps → 403; own-app flows allow);
  exchange JSON token-free (string-matched); tampered cookie 401; outage 503
  with retry recovery; flag-off 404s; mocked zero-balance chip; 360/390/430
  overflow-free. Real client fails closed (503) without a token in prod and
  uses the mock only off-prod.
- No open BLOCKER/P1. Phase 1 exit gate met → auto-continue Phase 2.

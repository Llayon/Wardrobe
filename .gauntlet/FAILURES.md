# FAILURES.md — Wardrobe Known Issues

## Inherited tooling lessons (proven in Holodilnik/UserPlatform, apply here)

- **WebK bridge:** Telegram Web injects NO `window.Telegram` — the page must
  include `telegram-web-app.js` (already in Wardrobe `index.html` from day
  one) plus a `tgWebAppData` location-hash fallback. Never assume the bridge
  exists; the `tg=false` debug pattern diagnoses it in one screenshot.
- **Env placement:** service credentials belong to the CALLER project
  (`USER_PLATFORM_SERVICE_TOKEN` in Wardrobe env, never in UserPlatform env).
  Verify placement with `vercel env ls` (names only) before blaming code.
- **Paste hygiene:** service tokens are `ups_<24hex>_<64hex>`; compare the
  middle `keyId` segment against `service:list` output when auth 401s.
- **npm workspace flags:** `npm run service:* -- --app …` swallows `--app`
  through npm workspaces — use
  `npx tsx apps/api/src/scripts/service.ts <cmd> --app …` in UserPlatform.
- **Preview URL churn:** every Preview redeploy mints a new URL — use a
  stable `vercel alias` for the staging smoke target from the start.
- **PowerShell curl:** never inline JSON in `-d`; always `-d @file`
  (UTF-8 no BOM), or use Node `fetch` scripts.

## F-001: Real telegram-web-app.js clobbers faked window.Telegram in E2E

- **Symptom:** All bridge-dependent E2E failed (anonymous landing instead of
  authenticated chip) while unit tests and the backend were green.
- **Cause:** `addInitScript` fakes run before page scripts; the real
  `telegram-web-app.js` then loads and replaces the fake with an empty
  bridge (no parent frame to wire in tests).
- **Fix:** E2E aborts the CDN script (`blockTelegramScript`) when faking the
  bridge, and covers the WebK hash path separately via `#tgWebAppData`.
  Production keeps the script untouched.
- **Rule:** never let the real bridge script load in a test that fakes the
  bridge object.

## Watch

- Single transient Node OOM (`Re-embedded builtins`) under `vitest run` on
  2026-09-22 with two tiny tests; clean 2/2 on immediate retry. Environmental
  (parallel node processes on this machine), not repo code. Reopen if it
  recurs in CI-like runs.
- ZAI 1305 overloads are frequent — vision fallback must stay fast (proved).
- Groq strict structured-output schemas reject non-exhaustive `required`
  lists (seen on recipes) — keep schemas minimal and integration-tested.
- Thumbnails in bytea fit MVP; revisit (Storage bucket) past ~10k items.

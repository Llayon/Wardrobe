# Wardrobe migrations — provenance rule

Files `20260919*_*.sql` and `20260920000000_service_bridge.sql` are
**byte-identical reference copies** of UserPlatform migrations. They exist
here for ONE reason: the shared Supabase project reconciles local-vs-remote
migration history by filename, so `supabase db push` from this repo needs to
see the already-applied platform files to proceed to ours.

Rules (binding):

- NEVER edit the `20260919*` / `20260920000000` files here. UserPlatform owns
  them; drift breaks `db push` reconciliation loudly (safe failure, not
  silent corruption).
- Wardrobe owns ONLY `20260922*` files (`wardrobe.*` schema, bucket).
- If UserPlatform adds migration N+1, copy it verbatim here before the next
  Wardrobe `db push` — same rule, no edits.

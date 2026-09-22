-- Wardrobe MVP: items table (Gauntlet 1 DRAFT — UNAPPLIED).
-- Dedicated `wardrobe.*` schema on the shared user-platform Supabase project.
-- Owner is the UserPlatform internal UUID as plain uuid with NO database FK
-- to platform tables (portability; authorization is application-side from
-- the validated session on every query). Thumbnails live in Storage (0002);
-- this table carries domain state only. Outfits arrive next gauntlet.
-- Conventions mirror UserPlatform: UUID PKs, UTC timestamps, RLS deny-first.

create schema if not exists wardrobe;

create table wardrobe.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  canonical_name text not null,
  display_name text not null default '',
  category text not null check (category in (
    'outerwear', 'top', 'bottom', 'dress', 'shoes', 'accessory'
  )),
  colors text[] not null default '{}',
  season text not null default 'all' check (season in ('all', 'summer', 'demi', 'winter')),
  status text not null default 'active' check (status in ('active', 'archived')),
  source_request_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Idempotent confirm retry: same user + same scan UUID never creates dupes.
  -- NULL source_request_id rows never collide (Postgres NULL semantics).
  unique (user_id, source_request_id)
);
create index wardrobe_items_user_status_idx on wardrobe.items (user_id, status);

-- Deny-by-default: API uses service-role server-side only (same posture as
-- UserPlatform); no public Supabase Data API access to wardrobe tables.
alter table wardrobe.items enable row level security;

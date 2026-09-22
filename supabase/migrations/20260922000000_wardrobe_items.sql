-- Wardrobe MVP schema (Gauntlet 0 DRAFT — UNAPPLIED, no project linked yet).
-- Dedicated `wardrobe.*` schema on the shared Supabase infrastructure.
-- Owner is the UserPlatform internal UUID as plain uuid with NO database FK
-- to platform tables (portability; authorization is application-side from
-- the validated session on every query). Outfits arrive next gauntlet.
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
  unique (user_id, source_request_id)
);
create index wardrobe_items_user_status_idx on wardrobe.items (user_id, status);

-- Thumbnails persist (product requirement): normalized WebP crop, metadata
-- stripped server-side, 50–150 KB target. Originals NEVER reach this table.
create table wardrobe.item_images (
  item_id uuid primary key references wardrobe.items (id) on delete cascade,
  thumbnail_webp bytea not null check (octet_length(thumbnail_webp) between 1024 and 512000),
  width integer not null check (width between 64 and 2048),
  height integer not null check (height between 64 and 2048),
  sha256 text not null,
  created_at timestamptz not null default now()
);

-- Deny-by-default: API uses service-role server-side only (same posture as
-- UserPlatform); no public Supabase Data API access to wardrobe tables.
alter table wardrobe.items enable row level security;
alter table wardrobe.item_images enable row level security;

-- Wardrobe MVP: private thumbnail storage + metadata (Gauntlet 1 DRAFT — UNAPPLIED).
-- Bucket `wardrobe-items` is PRIVATE: no permissive storage.objects policies
-- are created for it, so anon/authenticated roles read nothing; the API uses
-- the service-role key server-side (bypasses RLS). Browsers receive bytes
-- only as base64 through authenticated Wardrobe endpoints — no signed URLs.
-- Paths are server-derived `<user_uuid>/<item_uuid>.webp` and additionally
-- pinned by the CHECK below; browser-supplied paths are never trusted.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wardrobe-items', 'wardrobe-items', false, 204800, array['image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = 204800,
  allowed_mime_types = array['image/webp'];

create table wardrobe.item_images (
  item_id uuid primary key references wardrobe.items (id) on delete cascade,
  storage_path text not null unique check (
    storage_path ~ '^[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}\.webp$'
  ),
  content_hash text not null,
  mime_type text not null default 'image/webp' check (mime_type = 'image/webp'),
  width integer not null check (width between 64 and 2048),
  height integer not null check (height between 64 and 2048),
  byte_size integer not null check (byte_size between 1024 and 204800),
  created_at timestamptz not null default now()
);

alter table wardrobe.item_images enable row level security;

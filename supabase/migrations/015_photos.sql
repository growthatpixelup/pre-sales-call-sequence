-- Content OS photo library: photos of Daksh to use in LinkedIn posts (/dashboard/content/photos).
-- Run once in Supabase: SQL Editor → New query → paste → Run.
--
-- Files live in the private Storage bucket `photos`; the browser uploads straight to Storage with a
-- signed upload URL the server hands out, so big phone photos never pass through a server action.
-- The dashboard shows them with short-lived signed URLs. One row per file in `photos`.

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 52428800, array['image/jpeg','image/png','image/webp','image/heic','image/heif','image/gif'])
on conflict (id) do nothing;

create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  -- Object path inside the `photos` bucket.
  path text not null unique,
  file_name text,
  content_type text,
  size_bytes bigint,
  width int,
  height int,
  caption text,
  tags text[] not null default '{}',
  -- When the photo was taken (the file's modified time, which phones set to capture time).
  taken_at timestamptz,
  -- Set when the photo goes into a post; post_url is the post it went into, if known.
  used_at timestamptz,
  post_url text,
  created_at timestamptz not null default now()
);
create index if not exists photos_created_idx on public.photos (created_at desc);

-- No policies: only server code with the service role key reads or writes these, like every other
-- table here. Same for the bucket: no storage policies, so only signed URLs reach the files.
alter table public.photos enable row level security;

commit;

notify pgrst, 'reload schema';

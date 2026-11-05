-- Content OS swipe file. Run once in Supabase: SQL Editor → New query → paste → Run.
-- Safe to run before or after deploying the matching code (/dashboard/content/swipe).
--
-- The Grok bot syncs the creator's X and LinkedIn bookmarks into `swipes` (one row per post, upserted
-- on platform + external_id + source_account) with its breakdown in `analysis`, and logs each sync in
-- `swipe_runs`. The dashboard only reads these tables (CONTENT_SWIPES_SOURCE=supabase).
-- Shape of the jsonb columns: docs/content-os.md.

begin;

create table if not exists public.swipes (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('x','linkedin')),
  external_id text not null,
  url text not null,
  author_name text, author_handle text, author_avatar_url text, author_followers int,
  text text,
  thread jsonb not null default '[]',
  quoted jsonb,
  media jsonb not null default '[]',
  metrics jsonb not null default '{}',
  engagement_rate numeric,
  outlier_score numeric,
  analysis jsonb,
  pillar text, hook_pattern text, has_media boolean default false, media_kind text,
  posted_at timestamptz,
  bookmarked_at timestamptz,
  source_account text not null default 'pixeluplabs',
  first_seen_at timestamptz not null default now(),
  last_synced_at timestamptz not null default now(),
  unique (platform, external_id, source_account)
);
create index if not exists swipes_order_idx on public.swipes (bookmarked_at desc);
create index if not exists swipes_outlier_idx on public.swipes (outlier_score desc);

create table if not exists public.swipe_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  trigger text not null default 'schedule' check (trigger in ('schedule','manual')),
  source_account text not null default 'pixeluplabs',
  status text not null default 'running' check (status in ('running','ok','partial','failed')),
  fetched int default 0, inserted int default 0, updated int default 0, failed int default 0,
  error text
);
create index if not exists swipe_runs_started_idx on public.swipe_runs (started_at desc);

-- No policies: only server code with the service role key (the app, the bot's endpoint) reads or
-- writes these, like every other table here.
alter table public.swipes enable row level security;
alter table public.swipe_runs enable row level security;

commit;

-- Let the Supabase API see the new tables straight away.
notify pgrst, 'reload schema';

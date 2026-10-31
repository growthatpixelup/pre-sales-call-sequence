-- "Post is live" Slack alerts: one row per post we've alerted (or seeded on Buffer's first run).
-- The unique key makes alerts idempotent: webhook retries and overlapping polls can't double-post.
-- Run once in Supabase: SQL Editor → New query → paste → Run.

create table if not exists public.published_post_alerts (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('typefully', 'buffer')),
  platform text not null,
  external_id text not null,
  url text not null,
  created_at timestamptz default now(),
  unique (source, external_id)
);

-- Row Level Security on, with no policies: only the server (secret / service_role key) can use it.
alter table public.published_post_alerts enable row level security;

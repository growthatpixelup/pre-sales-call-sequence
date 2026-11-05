-- Content OS analytics from the platforms' own exports, for the numbers no API gives us:
--   LinkedIn: Analytics → Export → "AggregateAnalytics_<name>_<from>_<to>.xlsx"
--   X:        Analytics → Export data → the account overview CSV and the content (posts) CSV
-- Run once in Supabase: SQL Editor → New query → paste → Run. Then load exports with
--   node --env-file=.env --env-file=.env.local --experimental-strip-types --import ./tests/register.mjs scripts/import-analytics-export.mts <file> [<file> …]
-- Imports upsert, so overlapping exports just refresh the numbers. The dashboard fills days after the
-- latest export from Buffer.

begin;

-- One row per platform per day: what happened that day (views that day, not per post).
create table if not exists public.content_daily (
  platform       text not null check (platform in ('x', 'linkedin')),
  date           date not null,
  impressions    integer not null default 0,
  engagements    integer not null default 0,
  likes          integer,
  comments       integer,
  reposts        integer,
  saves          integer,
  new_followers  integer,
  -- Followers at the end of the day (LinkedIn: worked back from the export's closing total).
  followers      integer,
  profile_visits integer,
  imported_at    timestamptz not null default now(),
  primary key (platform, date)
);

-- One row per post an export lists, with its lifetime numbers at export time.
create table if not exists public.content_posts (
  platform         text not null check (platform in ('x', 'linkedin')),
  -- The number in the post's URL (X status id; LinkedIn share/ugcPost/activity id).
  post_id          text not null,
  url              text not null,
  published_at     timestamptz not null,
  text             text,
  post_type        text,
  impressions      integer,
  engagements      integer,
  likes            integer,
  comments         integer,
  reposts          integer,
  saves            integer,
  shares           integer,
  new_followers    integer,
  profile_visits   integer,
  imported_at      timestamptz not null default now(),
  primary key (platform, post_id)
);
create index if not exists content_posts_published_idx on public.content_posts (platform, published_at desc);

-- One row per export: its period, headline numbers and (LinkedIn) audience demographics.
create table if not exists public.content_exports (
  platform         text not null check (platform in ('x', 'linkedin')),
  kind             text not null,
  period_from      date not null,
  period_to        date not null,
  impressions      integer,
  members_reached  integer,
  followers        integer,
  audience         jsonb not null default '[]',
  content_audience jsonb not null default '[]',
  imported_at      timestamptz not null default now(),
  primary key (platform, kind, period_from, period_to)
);

alter table public.content_daily enable row level security;
alter table public.content_posts enable row level security;
alter table public.content_exports enable row level security;

commit;

notify pgrst, 'reload schema';

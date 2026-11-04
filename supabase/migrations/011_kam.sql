-- KAM (key account marketing), spec.md build step 3. Run once in Supabase: SQL Editor → New
-- query → paste → Run. Run it before deploying the matching code.
--
-- Members work 3–5 accounts each, warm up ~10 stakeholders across them with likes, comments and
-- DMs, and post what they did in #account-based-marketing. The app reads that channel
-- (/api/cron/kam-slack), has Claude turn each update into activity rows, and matches the people
-- in it to stakeholders. Anyone it can't match waits in a review list.

begin;

create table public.kam_members (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  slack_user_id text unique,
  email         text,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create table public.kam_accounts (
  id         uuid primary key default gen_random_uuid(),
  company    text not null,
  domain     text,
  website    text,
  owner_id   uuid references public.kam_members (id) on delete set null,
  status     text not null default 'active' check (status in ('active', 'paused', 'won', 'dropped')),
  notes      text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index kam_accounts_company_idx on public.kam_accounts (lower(company));

create table public.kam_stakeholders (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.kam_accounts (id) on delete cascade,
  name          text not null,
  role          text,
  linkedin_url  text,
  x_url         text,
  stage         text not null default 'identified'
                check (stage in ('identified', 'engaging', 'dm_sent', 'replied', 'conversation', 'call_booked')),
  owner_id      uuid references public.kam_members (id) on delete set null,
  -- The pipeline lead once they book a call (or a lead attributed to them later).
  lead_id       uuid references public.leads (id) on delete set null,
  notes         text not null default '',
  last_touch_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index kam_stakeholders_account_idx on public.kam_stakeholders (account_id);
create index kam_stakeholders_linkedin_idx on public.kam_stakeholders (linkedin_url);
create index kam_stakeholders_x_idx on public.kam_stakeholders (x_url);
create index kam_stakeholders_lead_idx on public.kam_stakeholders (lead_id);

-- One message from #account-based-marketing (a top-level post or a thread reply).
create table public.kam_slack_messages (
  id           uuid primary key default gen_random_uuid(),
  channel      text not null,
  ts           text not null,
  thread_ts    text,
  user_id      text not null,
  member_id    uuid references public.kam_members (id) on delete set null,
  text         text not null,
  posted_at    timestamptz not null,
  -- Slack's edited.ts: a changed value means the message was edited and is read again.
  edited_ts    text,
  status       text not null default 'pending'
               check (status in ('pending', 'logged', 'needs_review', 'ignored', 'failed')),
  error        text,
  processed_at timestamptz,
  created_at   timestamptz not null default now(),
  unique (channel, ts)
);

create index kam_slack_messages_status_idx on public.kam_slack_messages (status);

create table public.kam_activity (
  id               bigint generated always as identity primary key,
  day              date not null,
  member_id        uuid references public.kam_members (id) on delete set null,
  account_id       uuid references public.kam_accounts (id) on delete set null,
  stakeholder_id   uuid references public.kam_stakeholders (id) on delete set null,
  type             text not null
                   check (type in ('like', 'comment', 'follow', 'connect', 'dm', 'reply', 'feedback', 'intro', 'other')),
  platform         text not null default 'linkedin' check (platform in ('linkedin', 'x', 'email', 'other')),
  -- "Liked 12 posts" is one row with count 12.
  count            integer not null default 1 check (count > 0),
  link             text,
  note             text,
  -- Who and where the update named, when it isn't matched to a stakeholder / account yet.
  person_name      text,
  company_name     text,
  -- Set when someone looked at an unmatched person and chose to leave it unmatched.
  reviewed         boolean not null default false,
  source           text not null default 'manual' check (source in ('manual', 'slack')),
  slack_message_id uuid references public.kam_slack_messages (id) on delete cascade,
  created_at       timestamptz not null default now()
);

create index kam_activity_day_idx on public.kam_activity (day);
create index kam_activity_stakeholder_idx on public.kam_activity (stakeholder_id, day);
create index kam_activity_member_idx on public.kam_activity (member_id, day);

create trigger kam_accounts_set_updated_at
  before update on public.kam_accounts
  for each row execute function public.set_updated_at();
create trigger kam_stakeholders_set_updated_at
  before update on public.kam_stakeholders
  for each row execute function public.set_updated_at();

alter table public.kam_members enable row level security;
alter table public.kam_accounts enable row level security;
alter table public.kam_stakeholders enable row level security;
alter table public.kam_slack_messages enable row level security;
alter table public.kam_activity enable row level security;

-- KAM wins: "how we won it".
alter table public.leads add column if not exists win_note text;

commit;

notify pgrst, 'reload schema';

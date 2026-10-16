-- Run once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- For a new project, then run supabase/migrations/003_email_sequence.sql and 004_email_cron.sql.
-- (002 is already included below.)

create table if not exists public.leads (
  -- Cal.com booking uid
  id                  text primary key,

  -- Booking form answers
  name                text not null,
  email               text not null default '',
  business_name       text,
  business_website    text,
  problem             text,
  booking_reason      text,
  capital_raised      text,
  investment_range    text,
  referral_source     text,
  extra_fields        jsonb not null default '[]'::jsonb,

  -- Answers from the old booking form, kept for leads that used it
  phone               text,
  topic               text,
  notes               text,
  budget              text,
  twitter             text,

  -- Booking details (kept in sync with Cal.com)
  start_time          timestamptz not null,
  end_time            timestamptz not null,
  time_zone           text,
  event_title         text,
  event_slug          text,
  meeting_url         text,
  booking_status      text not null default 'accepted'
                      check (booking_status in ('accepted', 'pending', 'cancelled', 'rejected')),
  cancellation_reason text,

  -- Tracking (owned by the dashboard)
  stage               text not null default 'new'
                      check (stage in ('new', 'contacted', 'qualified', 'won', 'lost')),
  internal_notes      text not null default '',

  source              text not null default 'webhook' check (source in ('webhook', 'import')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists leads_start_time_idx on public.leads (start_time desc);
create index if not exists leads_email_idx on public.leads (email);

create table if not exists public.lead_events (
  id         bigint generated always as identity primary key,
  -- "on update cascade" lets a reschedule move a lead to its new booking uid.
  lead_id    text not null references public.leads (id) on update cascade on delete cascade,
  type       text not null,
  detail     text,
  at         timestamptz not null default now()
);

create index if not exists lead_events_lead_id_idx on public.lead_events (lead_id, at);

-- Keep updated_at current on every change.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists leads_set_updated_at on public.leads;
create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

-- Row Level Security on, with no policies: the public (anon) key can't read or write anything.
-- The app talks to Supabase from the server with the secret / service_role key, which bypasses RLS.
alter table public.leads enable row level security;
alter table public.lead_events enable row level security;

-- Pre-call email sequence. Run once in Supabase: SQL Editor → New query → paste → Run.

-- Cal.com event type (used to look up open slots for the no-show email) and per-lead email
-- personalisation set from the dashboard (case study, discovery question, who's joining).
alter table public.leads
  add column if not exists event_type_id  bigint,
  add column if not exists email_settings jsonb not null default '{}'::jsonb;

-- One row per email per lead. The sender (/api/cron/emails) sends rows that are due.
create table if not exists public.lead_emails (
  id         uuid primary key default gen_random_uuid(),
  lead_id    text not null references public.leads (id) on update cascade on delete cascade,
  step       text not null
             check (step in ('confirmation', 'case_study', 'how_we_work', 'what_to_expect', 'reminder_1h', 'no_show')),
  status     text not null default 'scheduled'
             check (status in ('scheduled', 'sending', 'sent', 'skipped', 'cancelled', 'failed')),
  due_at     timestamptz,
  -- Why it was skipped or cancelled, or the last error.
  note       text,
  subject    text,
  resend_id  text,
  attempts   integer not null default 0,
  sent_at    timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lead_id, step)
);

create index if not exists lead_emails_due_idx on public.lead_emails (status, due_at);

drop trigger if exists lead_emails_set_updated_at on public.lead_emails;
create trigger lead_emails_set_updated_at
  before update on public.lead_emails
  for each row execute function public.set_updated_at();

alter table public.lead_emails enable row level security;

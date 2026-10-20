-- Pipeline tracking, hand-sent Email 1 and replies. Run once in Supabase: SQL Editor → New query →
-- paste → Run.

-- More stages. "proposal" = proposal sent; "closed" = finished without a win or loss (not a fit,
-- went quiet).
alter table public.leads drop constraint if exists leads_stage_check;
alter table public.leads add constraint leads_stage_check
  check (stage in ('new', 'contacted', 'qualified', 'proposal', 'won', 'lost', 'closed'));

alter table public.leads
  -- When the call was booked in Cal.com. created_at is when the lead reached us, which for
  -- imported bookings is the import time.
  add column if not exists booked_at        timestamptz,
  -- Agreed deal value, set on the dashboard. Analytics fall back to the investment range.
  add column if not exists deal_value       numeric,
  -- When the stage last changed (e.g. when it was marked won).
  add column if not exists stage_changed_at timestamptz;

update public.leads set booked_at = created_at where booked_at is null;
alter table public.leads alter column booked_at set default now();
alter table public.leads alter column booked_at set not null;

create index if not exists leads_booked_at_idx on public.leads (booked_at);

-- Email 1 waits as a "draft" until it's personalised and sent from the dashboard.
alter table public.lead_emails drop constraint if exists lead_emails_status_check;
alter table public.lead_emails add constraint lead_emails_status_check
  check (status in ('draft', 'scheduled', 'sending', 'sent', 'skipped', 'cancelled', 'failed'));

-- Email 1s already queued to send automatically become drafts, and Email 2s waiting on them are
-- removed (they're planned again once Email 1 is sent).
update public.lead_emails set status = 'draft', note = null
  where step = 'case_study' and status = 'scheduled';
delete from public.lead_emails h
  where h.step = 'how_we_work' and h.status = 'scheduled'
    and not exists (
      select 1 from public.lead_emails c
      where c.lead_id = h.lead_id and c.step = 'case_study' and c.status = 'sent'
    );

-- Replies to the sequence, received by Resend (webhook: /api/webhooks/resend).
create table if not exists public.lead_replies (
  id              uuid primary key default gen_random_uuid(),
  -- Null when the sender couldn't be matched to a lead.
  lead_id         text references public.leads (id) on update cascade on delete set null,
  resend_email_id text not null unique,
  from_email      text not null,
  from_name       text,
  subject         text not null default '',
  text_body       text,
  html_body       text,
  received_at     timestamptz not null default now(),
  read_at         timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists lead_replies_lead_id_idx on public.lead_replies (lead_id, received_at desc);
create index if not exists lead_replies_received_at_idx on public.lead_replies (received_at desc);

alter table public.lead_replies enable row level security;

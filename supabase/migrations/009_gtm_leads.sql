-- GTM OS leads (spec.md, build step 1). Run once in Supabase: SQL Editor → New query → paste → Run.
-- Deploy the matching code right after: it reads `bookings` and `leads` as defined here.
--
-- Until now a "lead" was a Cal.com booking. A lead now starts at the first two-way signal from any
-- channel (Cal, Contra, outbound, X, founder inbox, KAM, inbound, referral) and may have no
-- booking at all. So:
--   * the old `leads` table becomes `bookings` (still owned by Cal.com), and its history table
--     `lead_events` becomes `booking_events`;
--   * a new `leads` table holds one row per deal, with the pipeline stage, origin and prices;
--   * each booking points at its lead (`bookings.lead_id`);
--   * `lead_activity` is the lead's own timeline (notes, DMs, stage changes, ...).
-- Existing bookings are grouped into leads by email, and their stages are carried over.

begin;

-- ---------------------------------------------------------------------------------------------
-- 1. Bookings

alter table public.leads rename to bookings;
alter table public.lead_events rename to booking_events;
alter table public.booking_events rename column lead_id to booking_id;
alter table public.lead_emails rename column lead_id to booking_id;
alter table public.lead_replies rename column lead_id to booking_id;

alter index if exists public.leads_pkey rename to bookings_pkey;
alter index if exists public.leads_start_time_idx rename to bookings_start_time_idx;
alter index if exists public.leads_email_idx rename to bookings_email_idx;
alter index if exists public.leads_booked_at_idx rename to bookings_booked_at_idx;
alter index if exists public.lead_events_lead_id_idx rename to booking_events_booking_id_idx;
alter trigger leads_set_updated_at on public.bookings rename to bookings_set_updated_at;

-- stage, stage_changed_at, deal_value and internal_notes on bookings are superseded by the lead.
-- They are kept (unused) until the move below has been checked, then dropped in a later migration.
comment on column public.bookings.stage is 'Legacy: replaced by leads.stage (migration 009).';
comment on column public.bookings.deal_value is 'Legacy: replaced by leads.closed_price / estimated_price (migration 009).';
comment on column public.bookings.internal_notes is 'Legacy: copied to leads.notes (migration 009).';

-- ---------------------------------------------------------------------------------------------
-- 2. Leads

create table public.leads (
  id               uuid primary key default gen_random_uuid(),

  -- Who
  contact_name     text not null default '',
  company          text,
  role             text,
  email            text,
  linkedin_url     text,
  -- Company domain for dedup; null for free-mail addresses with no website.
  domain           text,
  funding_stage    text,
  icp_fit          text check (icp_fit in ('strong', 'medium', 'weak')),

  -- Origin: the first touch. Never changed by later signals.
  origin           text not null
                   check (origin in ('cal', 'contra', 'outbound', 'x_outreach', 'founder_inbox', 'kam', 'inbound', 'referral')),
  -- LinkedIn account, campaign, referrer, Contra job, UTM, ...
  origin_detail    text,
  -- What they said when they booked a call ("How did you find us?" / UTM). Set by the first booking.
  booking_source   text,
  owner            text,

  -- Status
  stage            text not null default 'engaged'
                   check (stage in ('engaged', 'call_booked', 'call_held', 'no_show', 'proposal_sent',
                                    'negotiating', 'won', 'paid', 'lost', 'nurture')),
  stage_changed_at timestamptz,
  -- Required when the stage is lost or nurture (enforced by the app).
  exit_reason      text,
  deal_type        text not null default 'project' check (deal_type in ('audit', 'project')),
  -- A project deal spawned from a paid audit points at the audit.
  parent_lead_id   uuid references public.leads (id) on delete set null,
  estimated_price  numeric,
  closed_price     numeric,
  next_action      text,
  next_action_due  date,
  last_touch_at    timestamptz,

  -- Context
  proposal_url     text,
  transcript_url   text,
  notes            text not null default '',

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index leads_email_idx on public.leads (lower(email));
create index leads_linkedin_url_idx on public.leads (linkedin_url);
create index leads_domain_idx on public.leads (domain);
create index leads_stage_idx on public.leads (stage);

create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

alter table public.leads enable row level security;

create table public.lead_activity (
  id      bigint generated always as identity primary key,
  lead_id uuid not null references public.leads (id) on delete cascade,
  -- note, dm, email, call, proposal, stage_changed, created, booking, ...
  type    text not null,
  detail  text,
  at      timestamptz not null default now()
);

create index lead_activity_lead_id_idx on public.lead_activity (lead_id, at);

alter table public.lead_activity enable row level security;

alter table public.bookings
  add column lead_id uuid references public.leads (id) on delete set null;
create index bookings_lead_id_idx on public.bookings (lead_id);

-- ---------------------------------------------------------------------------------------------
-- 3. Backfill: one lead per email address (or per booking when there's no email). Our own and
-- test bookings (lib/bookings/internal.ts) get no lead.

create temp table booking_people on commit drop as
select
  b.*,
  coalesce(nullif(lower(trim(b.email)), ''), 'booking:' || b.id) as person,
  case b.stage
    when 'new'       then 'call_booked'
    when 'contacted' then 'call_held'
    when 'qualified' then 'call_held'
    when 'proposal'  then 'proposal_sent'
    when 'payment'   then 'won'
    when 'won'       then 'paid'
    when 'lost'      then 'lost'
    when 'closed'    then 'nurture'
  end as new_stage
from public.bookings b
where split_part(lower(trim(b.email)), '@', 2) not in ('pixeluplabs.com', 'pixelup.in')
  and lower(trim(b.email)) <> 'goyalmonesh2201@gmail.com';

create temp table stage_rank (stage text primary key, rank int) on commit drop;
insert into stage_rank values
  ('lost', 0), ('nurture', 1), ('engaged', 2), ('call_booked', 3), ('no_show', 4), ('call_held', 5),
  ('proposal_sent', 6), ('negotiating', 7), ('won', 8), ('paid', 9);

create temp table person_leads on commit drop as
select person, gen_random_uuid() as lead_id
from booking_people
group by person;

insert into public.leads (
  id, contact_name, company, email, domain, origin, origin_detail, booking_source, stage,
  stage_changed_at, exit_reason, estimated_price, closed_price, last_touch_at, notes, created_at
)
select
  pl.lead_id,
  latest.name,
  latest.business_name,
  nullif(trim(latest.email), ''),
  coalesce(
    case
      when split_part(lower(trim(latest.email)), '@', 2) in (
        'gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
        'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'yandex.com', 'hey.com'
      ) then null
      else nullif(split_part(lower(trim(latest.email)), '@', 2), '')
    end,
    nullif(regexp_replace(lower(coalesce(latest.business_website, '')), '^(https?://)?(www\.)?([^/?#]+).*$', '\3'), '')
  ),
  'cal',
  first_booking.referral_source,
  first_booking.referral_source,
  best.new_stage,
  agg.stage_changed_at,
  case when best.new_stage in ('lost', 'nurture') then 'Closed before the GTM OS (no reason recorded)' end,
  case when best.new_stage not in ('won', 'paid') then agg.deal_value end,
  case when best.new_stage in ('won', 'paid') then agg.deal_value end,
  agg.last_touch_at,
  agg.notes,
  agg.created_at
from person_leads pl
-- The latest booking carries the current contact details.
cross join lateral (
  select * from booking_people bp where bp.person = pl.person order by bp.start_time desc limit 1
) latest
cross join lateral (
  select * from booking_people bp where bp.person = pl.person order by bp.booked_at asc limit 1
) first_booking
-- The furthest stage any of their bookings reached.
cross join lateral (
  select bp.new_stage
  from booking_people bp join stage_rank r on r.stage = bp.new_stage
  where bp.person = pl.person
  order by r.rank desc
  limit 1
) best
cross join lateral (
  select
    max(bp.stage_changed_at) as stage_changed_at,
    max(bp.deal_value) as deal_value,
    min(bp.booked_at) as created_at,
    greatest(
      max(bp.booked_at),
      max(case when bp.booking_status = 'accepted' and bp.start_time < now() then bp.start_time end)
    ) as last_touch_at,
    coalesce(string_agg(nullif(trim(bp.internal_notes), ''), E'\n\n' order by bp.start_time), '') as notes
  from booking_people bp
  where bp.person = pl.person
) agg;

-- Linking isn't a Cal.com change, so leave bookings.updated_at alone.
alter table public.bookings disable trigger bookings_set_updated_at;
update public.bookings b
set lead_id = pl.lead_id
from booking_people bp
join person_leads pl on pl.person = bp.person
where b.id = bp.id;
alter table public.bookings enable trigger bookings_set_updated_at;

insert into public.lead_activity (lead_id, type, detail, at)
select l.id, 'created', 'Moved over from the Call Leads dashboard', l.created_at
from public.leads l;

commit;

-- Let the Supabase API see the renamed and new tables straight away.
notify pgrst, 'reload schema';

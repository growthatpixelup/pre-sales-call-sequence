-- "Payment processing" stage: the deal is agreed, waiting on their payment. Run once in Supabase:
-- SQL Editor → New query → paste → Run.
alter table public.leads drop constraint if exists leads_stage_check;
alter table public.leads add constraint leads_stage_check
  check (stage in ('new', 'contacted', 'qualified', 'proposal', 'payment', 'won', 'lost', 'closed'));

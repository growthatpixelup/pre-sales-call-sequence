-- New booking form (Oct 2026). Run once in Supabase: SQL Editor → New query → paste → Run.
-- The old form's columns (phone, topic, notes, budget, twitter) are kept so leads that
-- booked with the old form keep their answers. New bookings leave them empty.

alter table public.leads
  add column if not exists business_name    text,
  add column if not exists business_website text,
  add column if not exists problem          text,
  add column if not exists booking_reason   text,
  add column if not exists capital_raised   text,
  add column if not exists investment_range text,
  add column if not exists referral_source  text;

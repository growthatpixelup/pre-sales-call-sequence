-- Lead channels from "How did you find us?" (spec.md, build step 2). Run once in Supabase:
-- SQL Editor → New query → paste → Run. Safe before or after deploying the matching code.
--
-- Leads that came in through Cal with origin "Cal" get a real channel where their answer names
-- one (same rules as lib/leads/attribution.ts fromAnswer). Answers that don't (LinkedIn,
-- X/Twitter, Other, blank) stay Cal.

begin;

with answers as (
  select l.id, coalesce(l.booking_source, l.origin_detail, '') as answer
  from public.leads l
  where l.origin = 'cal'
),
mapped as (
  select id,
    case
      when answer ~* 'contra'                                       then 'contra'
      when answer ~* 'clutch|designrush|design rush|design for b2b|designforb2b|medium'
                                                                    then 'inbound'
      when answer ~* 'chatgpt|claude|perplexity|gemini|\mai\M'      then 'inbound'
      when answer ~* 'google|search|seo'                            then 'inbound'
      when answer ~* 'y ?combinator|\myc\M|urban innovation|past client|existing client|worked with|referr|friend|word of mouth|recommend'
                                                                    then 'referral'
    end as origin,
    case
      when answer ~* 'contra'                                       then 'Contra'
      when answer ~* 'clutch'                                       then 'Clutch'
      when answer ~* 'designrush|design rush'                       then 'DesignRush'
      when answer ~* 'design for b2b|designforb2b'                  then 'Design for B2B'
      when answer ~* 'medium'                                       then 'Medium'
      when answer ~* 'chatgpt|claude|perplexity|gemini|\mai\M'      then 'AI search'
      when answer ~* 'google|search|seo'                            then 'Google search'
      when answer ~* 'y ?combinator|\myc\M'                         then 'YC network'
      when answer ~* 'urban innovation'                             then 'Urban Innovation Fund'
      when answer ~* 'past client|existing client|worked with'      then 'Past client'
      else 'Referral'
    end as detail
  from answers
)
update public.leads l
set origin = m.origin, origin_detail = m.detail
from mapped m
where l.id = m.id and m.origin is not null;

commit;

notify pgrst, 'reload schema';

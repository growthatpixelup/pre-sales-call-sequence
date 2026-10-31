-- Polls Buffer for newly sent LinkedIn posts. Vercel Hobby cron can't run this often, so Supabase
-- pg_cron calls the app instead. Run once in Supabase (SQL Editor) AFTER deploying the app and
-- running 007_published_post_alerts.sql.
--
-- STEP 1 (one time, run it on its own, NOT saved in this file / git):
--   Store CRON_SECRET (the same value as in Vercel) in Supabase Vault:
--
--     select vault.create_secret('<paste CRON_SECRET here>', 'cron_secret');
--
--   To change it later:
--     select vault.update_secret(
--       (select id from vault.secrets where name = 'cron_secret'), '<new value>');
--
-- STEP 2: run the rest of this file.
--
-- INTERVAL: every 30 minutes = 48 Buffer API calls/day (one request per run), which fits the
-- Buffer Free plan. On Essentials/Team you can go to every 15 minutes: change the schedule below
-- to '*/15 * * * *' and run this file again (scheduling the same job name replaces it).
--
-- pg_net doesn't follow redirects: use the domain the app is served on.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'buffer-sent-alerts',
  '*/30 * * * *',
  $$
  select net.http_get(
    url := 'https://pre-sales-call-sequence.vercel.app/api/cron/buffer-sent',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 30000
  );
  $$
);

-- To check it's running:   select * from cron.job_run_details order by start_time desc limit 10;
-- To see the HTTP results: select status_code, content from net._http_response order by created desc limit 10;
-- To stop it:              select cron.unschedule('buffer-sent-alerts');

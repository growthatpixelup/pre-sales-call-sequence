-- Reads KAM updates from #account-based-marketing every 15 minutes. Run once in Supabase (SQL
-- Editor) AFTER deploying the app, running 011_kam.sql, and setting SLACK_KAM_CHANNEL in Vercel.
-- Uses the 'cron_secret' Vault secret created for 008_buffer_poll_cron.sql.
--
-- pg_net doesn't follow redirects: use the domain the app is served on.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'kam-slack-sync',
  '*/15 * * * *',
  $$
  select net.http_get(
    url := 'https://pre-sales-call-sequence.vercel.app/api/cron/kam-slack',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    -- Reading updates with Claude can take a while.
    timeout_milliseconds := 120000
  );
  $$
);

-- To check it's running:   select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'kam-slack-sync') order by start_time desc limit 10;
-- To stop it:              select cron.unschedule('kam-slack-sync');

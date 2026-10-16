-- Runs the email sender every minute. Run once in Supabase (SQL Editor) AFTER deploying the app.
-- Replace the two placeholders first:
--   YOUR-APP-URL  → your Vercel domain, e.g. pre-sales-call-sequence.vercel.app
--   YOUR-CRON-SECRET → the CRON_SECRET value you set in Vercel

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'send-due-emails',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://pre-sales-call-sequence.vercel.app/api/cron/emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer YOUR-CRON-SECRET',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

-- To check it's running:   select * from cron.job_run_details order by start_time desc limit 10;
-- To see the HTTP results: select * from net._http_response order by created desc limit 10;
-- To stop it:              select cron.unschedule('send-due-emails');

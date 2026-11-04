import { timingSafeEqual } from "node:crypto";
import { syncKamSlack } from "@/lib/kam/sync";

/**
 * Reads new KAM updates from Slack and logs them. Supabase pg_cron calls this every 15 minutes
 * (supabase/migrations/012_kam_slack_cron.sql).
 */
// Claude reads each new update; a busy day can take a while.
export const maxDuration = 300;

async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_SECRET is not configured" }, { status: 500 });

  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return Response.json(await syncKamSlack());
  } catch (err) {
    console.error("[kam cron] sync failed:", err);
    return Response.json({ error: err instanceof Error ? err.message : "Sync failed" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;

import { timingSafeEqual } from "node:crypto";
import { processDueEmails } from "@/lib/emails/sender";

/** Sends due emails. Supabase pg_cron calls this every minute (supabase/migrations/004_email_cron.sql). */
async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_SECRET is not configured" }, { status: 500 });

  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  return Response.json(await processDueEmails());
}

export const GET = handle;
export const POST = handle;

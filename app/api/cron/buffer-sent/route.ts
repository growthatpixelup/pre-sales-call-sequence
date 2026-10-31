import { timingSafeEqual } from "node:crypto";
import { pollBufferSent } from "@/lib/social-alerts/buffer";
import { postToSlack } from "@/lib/social-alerts/slack";
import { supabaseAlertStore } from "@/lib/social-alerts/store";

/**
 * Posts newly sent LinkedIn posts (via Buffer) to Slack. Buffer has no webhooks, so Supabase
 * pg_cron calls this on a schedule (supabase/migrations/008_buffer_poll_cron.sql).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_SECRET is not configured" }, { status: 500 });

  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await pollBufferSent(
    {
      apiKey: process.env.BUFFER_API_KEY,
      orgId: process.env.BUFFER_ORG_ID,
      channelIds: process.env.BUFFER_LINKEDIN_CHANNEL_IDS,
    },
    { store: supabaseAlertStore(), notify: (text) => postToSlack(text) },
  );

  return Response.json(result.body, { status: result.status });
}

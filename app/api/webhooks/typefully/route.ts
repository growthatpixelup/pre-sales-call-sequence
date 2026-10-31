import { postToSlack } from "@/lib/social-alerts/slack";
import { supabaseAlertStore } from "@/lib/social-alerts/store";
import { handleTypefullyWebhook } from "@/lib/social-alerts/typefully";

/** Typefully "Draft Published" webhook → Slack "post is live" alert. Authenticated by signature. */
export async function POST(request: Request) {
  // The signature covers the exact bytes Typefully sent: read the raw body, never re-serialize.
  const rawBody = await request.text();

  const result = await handleTypefullyWebhook(
    rawBody,
    {
      timestamp: request.headers.get("x-typefully-timestamp"),
      signature: request.headers.get("x-typefully-signature"),
      event: request.headers.get("x-typefully-event"),
    },
    { secret: process.env.TYPEFULLY_WEBHOOK_SECRET, store: supabaseAlertStore(), notify: (text) => postToSlack(text) },
  );

  return Response.json(result.body, { status: result.status });
}

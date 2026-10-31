import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import type { AlertDeps } from "./alert";
import { sendAlert } from "./alert";
import type { Platform } from "./slack";
import { xHandleFromUrl } from "./slack";

const MAX_AGE_SECONDS = 5 * 60;

type VerifyInput = {
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  secret: string;
  /** Milliseconds; defaults to Date.now(). */
  now?: number;
};

/**
 * Typefully signs `${timestamp}.${rawBody}` with HMAC-SHA256 and sends "sha256=<hex>".
 * Also rejects timestamps more than 5 minutes from now (replay protection).
 */
export function verifyTypefullySignature({ rawBody, timestamp, signature, secret, now = Date.now() }: VerifyInput) {
  if (!timestamp || !signature || !/^\d+$/.test(timestamp.trim())) return false;
  const ts = Number(timestamp.trim());
  if (Math.abs(now / 1000 - ts) > MAX_AGE_SECONDS) return false;

  const expected = "sha256=" + createHmac("sha256", secret).update(`${timestamp.trim()}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature.trim(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

type Json = Record<string, unknown>;

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Published links in a DraftDetail, one per platform. */
export function publishedUrls(data: Json): { platform: Platform; url: string }[] {
  const out: { platform: Platform; url: string }[] = [];
  const x = str(data.x_published_url) ?? str(data.x_article_published_url);
  if (x) out.push({ platform: "x", url: x });
  const linkedin = str(data.linkedin_published_url);
  if (linkedin) out.push({ platform: "linkedin", url: linkedin });
  return out;
}

export type WebhookResult = { status: number; body: Json };

type Headers = { timestamp: string | null; signature: string | null; event: string | null };

/** Everything the route does, minus reading the request. */
export async function handleTypefullyWebhook(
  rawBody: string,
  headers: Headers,
  deps: AlertDeps & { secret: string | undefined; now?: number },
): Promise<WebhookResult> {
  if (!deps.secret) return { status: 500, body: { error: "TYPEFULLY_WEBHOOK_SECRET is not configured" } };

  const valid = verifyTypefullySignature({
    rawBody,
    timestamp: headers.timestamp,
    signature: headers.signature,
    secret: deps.secret,
    now: deps.now,
  });
  if (!valid) return { status: 401, body: { error: "Invalid signature" } };

  let body: Json;
  try {
    body = JSON.parse(rawBody) as Json;
  } catch {
    return { status: 400, body: { error: "Invalid JSON" } };
  }

  // draft.status_changed fires alongside draft.published; handling both would double-post.
  const event = str(body.event) ?? headers.event;
  if (event !== "draft.published") return { status: 200, body: { ignored: event } };

  const data = (body.data ?? {}) as Json;
  const draftId = data.id == null ? null : String(data.id);
  if (!draftId) return { status: 400, body: { error: "Missing data.id" } };

  const results: Record<string, string> = {};
  let failed = false;
  for (const { platform, url } of publishedUrls(data)) {
    try {
      results[platform] = await sendAlert(
        {
          source: "typefully",
          platform,
          external_id: `${draftId}:${platform}`,
          url,
          accountLabel: platform === "x" ? xHandleFromUrl(url) : null,
          text: str(data.preview),
        },
        deps,
      );
    } catch (err) {
      failed = true;
      results[platform] = "failed";
      console.error(`[typefully webhook] alert for draft ${draftId} (${platform}) failed:`, err);
    }
  }

  // 500 makes Typefully retry; rows that did post are deduped on the retry.
  return { status: failed ? 500 : 200, body: { draftId, results } };
}

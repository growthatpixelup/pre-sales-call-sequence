import "server-only";

export type Platform = "x" | "linkedin";

const PLATFORM_NAMES: Record<string, string> = { x: "X", linkedin: "LinkedIn" };
const PREVIEW_CHARS = 80;

/** "@handle" from an X/Twitter status URL (x.com/{handle}/status/...), or null. */
export function xHandleFromUrl(url: string): string | null {
  const match = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\//i.exec(url);
  return match ? `@${match[1]}` : null;
}

/** Slack mrkdwn treats &, < and > as control characters. */
function escapeSlack(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** First ~80 characters of the post on one line, with "…" when it was cut. */
export function previewText(text: string | null | undefined): string | null {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  if (!flat) return null;
  if (flat.length <= PREVIEW_CHARS) return flat;
  return `${flat.slice(0, PREVIEW_CHARS).trimEnd()}…`;
}

export type AlertMessage = {
  platform: Platform | string;
  accountLabel: string | null;
  text: string | null;
  url: string;
};

/**
 * :large_green_circle: *New post live on X* · @handle
 * _"first ~80 characters…"_
 * https://...   ← own line, so Slack unfurls it
 */
export function formatSlackMessage({ platform, accountLabel, text, url }: AlertMessage): string {
  const name = PLATFORM_NAMES[platform] ?? platform;
  const header = `:large_green_circle: *New post live on ${name}*${accountLabel ? ` · ${escapeSlack(accountLabel)}` : ""}`;
  const preview = previewText(text);
  const lines = [header];
  if (preview) lines.push(`_"${escapeSlack(preview)}"_`);
  lines.push(url);
  return lines.join("\n");
}

/**
 * Posts to the Slack incoming webhook in SLACK_WEBHOOK_URL. With DRY_RUN=true it only logs the
 * payload. Never logs the webhook URL. Throws if Slack doesn't accept the message.
 */
export async function postToSlack(text: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  // No mentions: post text is escaped (so no <!channel>/<@U…>), and link_names stays off.
  const payload = { text, unfurl_links: true, unfurl_media: true };

  if (process.env.DRY_RUN === "true") {
    console.log("[social-alerts] DRY_RUN Slack payload:", JSON.stringify(payload));
    return;
  }

  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) throw new Error("SLACK_WEBHOOK_URL is not configured");

  const res = await fetchImpl(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Slack webhook failed: ${res.status} ${body.slice(0, 200)}`);
  }
}

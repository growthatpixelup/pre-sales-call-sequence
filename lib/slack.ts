import "server-only";

import { formatCallTime } from "@/lib/format";
import { bookingToLeadFields, formAnswers } from "@/lib/leads/fields";
import { isInternal } from "@/lib/leads/internal";
import type { BookingInput } from "@/lib/leads/types";

/**
 * "A call was booked" messages, posted to Slack by the bot behind SLACK_BOT_TOKEN (it needs the
 * chat:write scope and, for a private channel, to be a member). Nothing is posted until both
 * SLACK_BOT_TOKEN and SLACK_SALES_CHANNEL are set.
 */

const POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage";

/** Slack reads &, < and > as markup, so form answers have them escaped. */
function escape(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The call time, then every booking form question with the lead's answer, as Cal.com sent them. */
export function callBookedMessage(booking: BookingInput): string {
  return [
    `:calendar: *A call was booked*${booking.bookingStatus === "pending" ? " (needs confirmation)" : ""}`,
    `Call: ${formatCallTime(booking.startTime)}`,
    "",
    ...formAnswers(booking).map(({ question, answer }) => `• ${escape(question)} - ${escape(answer)}`),
  ].join("\n");
}

/** Posts a new booking to the sales channel. Our own and test bookings are skipped. */
export async function notifyCallBooked(booking: BookingInput): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_SALES_CHANNEL;
  if (!token || !channel || isInternal(bookingToLeadFields(booking))) return;

  const res = await fetch(POST_MESSAGE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ channel, text: callBookedMessage(booking), unfurl_links: false, unfurl_media: false }),
    signal: AbortSignal.timeout(10_000),
  });
  // Slack reports most errors as a 200 with ok: false.
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!data.ok) throw new Error(`Slack: could not post the booking: ${data.error ?? `HTTP ${res.status}`}`);
}

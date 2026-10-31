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

/** Slack allows at most 10 fields per section and 2,000 characters per field. */
const MAX_FIELDS = 10;
const MAX_TEXT = 2000;
/** Answers longer than this get a full-width row instead of a cell in the two-column grid. */
const SHORT_ANSWER = 60;

/** Slack reads &, < and > as markup, so form answers have them escaped. */
function escape(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function mrkdwn(text: string) {
  return { type: "mrkdwn", text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text };
}

/**
 * The message as Block Kit: the call time, then every booking form question with the lead's
 * answer, as Cal.com sent them. Short answers sit in a two-column grid, long ones below it.
 */
export function callBookedBlocks(booking: BookingInput): object[] {
  const answers = formAnswers(booking);
  const cell = ({ question, answer }: { question: string; answer: string }) =>
    mrkdwn(`*${escape(question)}*\n${escape(answer)}`);
  const short = answers.filter((a) => a.answer.length <= SHORT_ANSWER);
  const long = answers.filter((a) => a.answer.length > SHORT_ANSWER);

  const blocks: object[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `:calendar: A call was booked${booking.bookingStatus === "pending" ? " (needs confirmation)" : ""}`,
        emoji: true,
      },
    },
    { type: "section", text: mrkdwn(`*Call:* ${formatCallTime(booking.startTime)}`) },
    { type: "divider" },
  ];
  for (let i = 0; i < short.length; i += MAX_FIELDS) {
    blocks.push({ type: "section", fields: short.slice(i, i + MAX_FIELDS).map(cell) });
  }
  for (const answer of long) blocks.push({ type: "section", text: cell(answer) });
  return blocks;
}

/** Posts a new booking to the sales channel. Our own and test bookings are skipped. */
export async function notifyCallBooked(booking: BookingInput): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_SALES_CHANNEL;
  const lead = bookingToLeadFields(booking);
  if (!token || !channel || isInternal(lead)) return;

  // `text` is what the notification shows; the blocks are the message itself.
  const text = `A call was booked: ${[lead.name, lead.businessName].filter(Boolean).join(", ")}`;
  const res = await fetch(POST_MESSAGE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ channel, text, blocks: callBookedBlocks(booking), unfurl_links: false, unfurl_media: false }),
    signal: AbortSignal.timeout(10_000),
  });
  // Slack reports most errors as a 200 with ok: false.
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!data.ok) throw new Error(`Slack: could not post the booking: ${data.error ?? `HTTP ${res.status}`}`);
}

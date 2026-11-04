import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { ACTIVITY_TYPES, PLATFORMS } from "./types";

/**
 * Turns one KAM update from Slack into touches with Claude. Matching names to stakeholders is
 * done afterwards in code (./match.ts); Claude only reads what the message says.
 */

const MODEL = "claude-opus-5-5";

const TouchSchema = z.object({
  type: z.enum(ACTIVITY_TYPES),
  platform: z.enum(PLATFORMS),
  count: z.number().int(),
  person: z.string().nullable(),
  company: z.string().nullable(),
  link: z.string().nullable(),
  note: z.string().nullable(),
  yesterday: z.boolean(),
});

const ExtractionSchema = z.object({ touches: z.array(TouchSchema) });

export type ExtractedTouch = z.infer<typeof TouchSchema>;

const SYSTEM = `You read daily updates that Pixelup's team posts in Slack about key-account marketing (KAM): warming up people at target companies by liking and commenting on their posts, following them, sending connect requests and DMs, sharing product feedback and making intros. Selling is not part of it.

Turn the update into a list of touches, one per thing done. For each touch:
- type: like, comment, follow, connect (connect request), dm (we sent them a DM), reply (THEY replied to us or messaged us), feedback (we sent product feedback), intro (we introduced them to someone), other.
- platform: linkedin, x, email or other. Default to linkedin when the update doesn't say.
- count: how many. "Liked 12 posts" is one touch with count 12. One person touched once is count 1.
- person: the person's name as written, or null when the update gives a number without naming anyone ("did 15 likes"). When a name clearly refers to someone in the known stakeholder list, use the list's spelling.
- company: their company as written (or from the known list), or null if not stated or known.
- link: the post or profile URL for this touch, copied exactly from the update, or null.
- note: a few words worth keeping (what the comment or DM was about, what they replied), or null.
- yesterday: true only if the update says the touch happened yesterday rather than today.

Rules:
- Only things already done. Skip plans ("will DM her tomorrow"), questions, greetings and chat.
- Separate touches for separate people, and for separate types on the same person (liked and commented = two touches).
- An update that lists no touches returns an empty list.`;

let client: Anthropic | null = null;

export async function extractTouches(input: {
  text: string;
  member: string;
  /** "Mon 4 Nov 2026", the day the update was posted. */
  date: string;
  known: { stakeholder: string; company: string }[];
}): Promise<ExtractedTouch[]> {
  client ??= new Anthropic();
  const known = input.known.length
    ? input.known.map((k) => `- ${k.stakeholder} (${k.company})`).join("\n")
    : "(none yet)";

  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "low", format: zodOutputFormat(ExtractionSchema) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Known stakeholders:\n${known}\n\nUpdate from ${input.member}, posted ${input.date}:\n<update>\n${input.text}\n</update>`,
      },
    ],
  });

  if (response.stop_reason === "refusal") throw new Error("Claude declined to read this update.");
  if (response.stop_reason === "max_tokens") throw new Error("The update was too long to read in one go.");
  if (!response.parsed_output) throw new Error("Claude's answer didn't match the expected format.");
  return response.parsed_output.touches;
}

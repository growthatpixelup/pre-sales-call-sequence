import type { Origin } from "./types";

/**
 * Which channel a Cal.com booking came from, by its "How did you find us?" answer. Answers that
 * don't pin down a channel (LinkedIn and X could be outreach or organic, "Other") return null: the
 * lead then stays at origin Cal.
 */

export interface Attribution {
  origin: Origin;
  /** Sub-source: directory, referrer group, ... */
  detail: string;
}

const ANSWER_RULES: { test: RegExp; origin: Origin; detail: string }[] = [
  { test: /contra/i, origin: "contra", detail: "Contra" },
  { test: /clutch/i, origin: "inbound", detail: "Clutch" },
  { test: /designrush|design rush/i, origin: "inbound", detail: "DesignRush" },
  { test: /design for b2b|designforb2b/i, origin: "inbound", detail: "Design for B2B" },
  { test: /medium/i, origin: "inbound", detail: "Medium" },
  { test: /chatgpt|claude|perplexity|gemini|\bai\b/i, origin: "inbound", detail: "AI search" },
  { test: /google|search|seo/i, origin: "inbound", detail: "Google search" },
  { test: /y ?combinator|\byc\b/i, origin: "referral", detail: "YC network" },
  { test: /urban innovation/i, origin: "referral", detail: "Urban Innovation Fund" },
  { test: /past client|existing client|worked with/i, origin: "referral", detail: "Past client" },
  { test: /referr|friend|word of mouth|recommend/i, origin: "referral", detail: "Referral" },
];

/** Channel from the "How did you find us?" answer, when it names one. */
export function fromAnswer(answer: string | null | undefined): Attribution | null {
  const text = answer?.trim();
  if (!text) return null;
  const rule = ANSWER_RULES.find((r) => r.test.test(text));
  return rule ? { origin: rule.origin, detail: rule.detail } : null;
}

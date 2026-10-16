/**
 * Everything the pre-call emails need that isn't on the lead: links, case studies, process
 * details and who joins the call. Copy comes from "PIXELUP Pre-Call Sequences" (V2).
 *
 * Anything still set to "TODO" stops emails from sending (the dashboard lists what's missing),
 * so no prospect ever gets an email with a placeholder in it.
 */

export interface CaseStudy {
  id: string;
  /** Client name, e.g. "Acme". */
  client: string;
  /** Finishes the subject "how we helped [client] …", e.g. "double their demo bookings". */
  result: string;
  /** "[client] is …", e.g. "a Series A fintech for freelancers". */
  description: string;
  /** "They came to us because …", e.g. "their brand looked smaller than their product". */
  problem: string;
  /** "We …" in 1–2 lines, e.g. "rebuilt their brand and site in 8 weeks, and demo bookings doubled." */
  whatWeDid: string;
  link: string;
}

export const emailConfig = {
  /** Signs off every email: "[senderName] @ PIXELUP". */
  senderName: "Daksh",
  company: "PIXELUP",

  /** Booking confirmation: "Here's one of our recent brand uplift breakdowns: [name] [link]". */
  confirmationCaseStudy: { name: "TODO", link: "TODO" },

  /** Email 1. The first one is used unless a different one is picked on the lead's page. */
  caseStudies: [
    {
      id: "default",
      client: "TODO",
      result: "TODO",
      description: "TODO",
      problem: "TODO",
      whatWeDid: "TODO",
      link: "TODO",
    },
  ] satisfies CaseStudy[] as CaseStudy[],

  /** Email 1: "What our clients say: [link]". */
  reviewsLink: "TODO",

  /** Email 1's closing question. `{company}` becomes the lead's business name. */
  discoveryQuestions: {
    competitor:
      "Quick q: the team's running a positioning discovery on {company} before our call, but we couldn't pin down who you see as your closest competitor. Who should we benchmark you against?",
    buyer:
      "Quick q: the team's running a positioning discovery on {company} before our call, but we want to know who this needs to win over. Who's your main buyer right now?",
  },

  /** Email 2: how we work. */
  process: {
    /** "you pick from [2–3] directions" */
    directions: "2–3",
    /** "stick around for [support period] of fixes" */
    supportPeriod: "TODO",
    /** Optional sentence after the support period. Set to "" to leave it out. */
    ownership: "You own every file.",
    /** "[X] weeks for brand" */
    brandWeeks: "TODO",
    /** "[Y] for brand + website" */
    brandAndWebsiteWeeks: "TODO",
    /** "Full breakdown: [link]". Email 3 links it again. */
    link: "TODO",
  },

  /**
   * Who joins the call from PIXELUP. Email 3 lists "name (role)"; the 1-hour reminder lists the
   * names. Can be changed per lead on the dashboard.
   */
  team: [{ name: "Daksh", role: "TODO" }],

  /** Local times (in the guest's time zone) for "morning" and "evening" sends. */
  morningHour: 9,
  eveningHour: 18,
} as const;

export type DiscoveryQuestion = keyof typeof emailConfig.discoveryQuestions;

/** Config values still set to "TODO". Emails don't send until this is empty. */
export function missingEmailConfig(): string[] {
  const missing: string[] = [];
  const walk = (value: unknown, path: string) => {
    if (typeof value === "string") {
      if (value.trim() === "TODO") missing.push(path);
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${path}[${i}]`));
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k);
    }
  };
  walk(emailConfig, "");
  return missing;
}

/**
 * Everything the pre-call emails need that isn't on the lead: links, case studies, process
 * details and who joins the call. Copy comes from "PIXELUP LABS Pre-Call Sequences" (9 Oct 2026).
 *
 * Anything still set to "TODO" stops emails from sending (the dashboard lists what's missing),
 * so no prospect ever gets an email with a placeholder in it.
 */

export interface CaseStudy {
  id: string;
  /** Client name, e.g. "Acme". Also the text of the case study link. */
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
  /** The booking confirmation and Email 1 sign off "[senderName] @ [company]"; the rest just "[senderName]". */
  senderName: "Daksh",
  company: "PIXELUP LABS",

  /** Booking confirmation: "Here's one of our recent brand uplift breakdowns: [name] [link]". */
  confirmationCaseStudy: { name: "Henry Labs", link: "https://www.pixeluplabs.com/case-studies/henrylabs" },

  /** Email 1. The first one is used unless a different one is picked on the lead's page. */
  caseStudies: [
    {
      id: "fuseai",
      client: "FuseAI",
      result: "lift trial conversion 20%",
      description: "a YC-backed AI sales platform",
      problem: "they were heading into a launch with a brand that wasn't ready for it",
      whatWeDid:
        "redesigned their brand, website, and product as one system. Since the redesign, their free-to-paid trial conversion is up 20%.",
      link: "https://www.pixeluplabs.com/case-studies/fuseai",
    },
  ] satisfies CaseStudy[] as CaseStudy[],

  /** Email 1: "What our clients say: [reviews on Contra]". */
  reviews: { name: "reviews on Contra", link: "https://contra.com/daksh_aswal_dt5tfn27/reviews" },

  /** Email 1's closing question. `{company}` becomes the lead's business name. */
  discoveryQuestions: {
    competitor:
      "Quick q: the team's running a positioning discovery on {company} before our call, but we couldn't pin down who you see as your closest competitor. Who should we benchmark you against?",
    buyer:
      "Quick q: the team's running a positioning discovery on {company} before our call, but we want to know who this needs to win over. Who's your main buyer right now?",
  },

  /** Email 2: how we work. */
  process: {
    /** "you pick from [3] directions" */
    directions: "3",
    /** "stick around for [support period]." */
    supportPeriod: "10 days of development support",
    /** "[X] weeks for brand" */
    brandWeeks: "2–4",
    /** "[Y] for brand + website" */
    brandAndWebsiteWeeks: "6–8",
  },

  /** Who joins the call from PIXELUP LABS, listed in Email 3 as "name (role)". Can be changed per lead. */
  team: [{ name: "Daksh", role: "Founder" }],

  /** Local times (in the guest's time zone). */
  howWeWorkHour: 9,
  /** Email 3 for calls at 12:00 PM or later: this hour on the call day. */
  whatToExpectMorningHour: 8,
  /** Email 3 for calls before 12:00 PM: this hour the day before. */
  whatToExpectEveningHour: 18,
  /** No sends from 9:00 PM to 8:00 AM, except the confirmation, 1-hour reminder and no-show nudge. */
  quietHours: { start: 21, end: 8 },
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

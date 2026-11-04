/**
 * Matching a new signal (a booking, a Contra response, an email, ...) to a lead we already have.
 * Order: email, then LinkedIn URL, then company domain. Free-mail domains never match on domain.
 */

const FREE_MAIL = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "yandex.com",
  "hey.com",
]);

export function normaliseEmail(email: string | null | undefined): string | null {
  const e = email?.trim().toLowerCase();
  return e && e.includes("@") ? e : null;
}

/** "https://www.linkedin.com/in/Jane-Doe/?utm=x" → "https://www.linkedin.com/in/jane-doe". */
export function normaliseLinkedIn(url: string | null | undefined): string | null {
  const m = url?.trim().match(/linkedin\.com\/(in|company)\/([^/?#\s]+)/i);
  return m ? `https://www.linkedin.com/${m[1].toLowerCase()}/${decodeURIComponent(m[2]).toLowerCase()}` : null;
}

/** "https://www.acme.io/about" or "acme.io" → "acme.io". */
export function hostOf(url: string | null | undefined): string | null {
  const m = url
    ?.trim()
    .toLowerCase()
    .match(/^(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)/);
  return m ? m[1] : null;
}

/** The company domain from an email address, else from a website. Null for free-mail with no site. */
export function companyDomain(email: string | null | undefined, website?: string | null): string | null {
  const fromEmail = normaliseEmail(email)?.split("@")[1];
  if (fromEmail && !FREE_MAIL.has(fromEmail)) return fromEmail;
  const fromSite = hostOf(website);
  return fromSite && !FREE_MAIL.has(fromSite) ? fromSite : null;
}

export interface Signal {
  email?: string | null;
  linkedinUrl?: string | null;
  domain?: string | null;
}

export interface MatchCandidate {
  id: string;
  email: string | null;
  linkedinUrl: string | null;
  domain: string | null;
  updatedAt: string;
}

export type MatchedOn = "email" | "linkedin" | "domain";

/**
 * Picks the lead a signal belongs to. Callers pass only leads that can take a new signal (not won
 * or paid: a new conversation after a win is a new deal). Most recently updated wins a tie.
 */
export function pickMatch<T extends MatchCandidate>(signal: Signal, candidates: T[]): { lead: T; on: MatchedOn } | null {
  const email = normaliseEmail(signal.email);
  const linkedin = normaliseLinkedIn(signal.linkedinUrl);
  const domain = signal.domain?.toLowerCase() || null;
  const newest = (list: T[]) => [...list].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];

  const checks: [MatchedOn, (c: T) => boolean][] = [
    ["email", (c) => email != null && normaliseEmail(c.email) === email],
    ["linkedin", (c) => linkedin != null && normaliseLinkedIn(c.linkedinUrl) === linkedin],
    ["domain", (c) => domain != null && c.domain?.toLowerCase() === domain],
  ];
  for (const [on, test] of checks) {
    const hits = candidates.filter(test);
    if (hits.length) return { lead: newest(hits), on };
  }
  return null;
}

import { hostOf, normaliseLinkedIn } from "@/lib/leads/dedup";
import type { KamAccount, KamStakeholder } from "./types";

/**
 * Matching the people and companies a Slack update names to KAM stakeholders and accounts.
 * A profile link is exact; names only match when there's exactly one candidate.
 */

/** "https://x.com/Jane_Doe/status/123" or "twitter.com/jane_doe" → "https://x.com/jane_doe". */
export function normaliseX(url: string | null | undefined): string | null {
  const m = url?.trim().match(/(?:x|twitter)\.com\/(@?[A-Za-z0-9_]{1,15})(?:[/?#]|$)/i);
  if (!m) return null;
  const handle = m[1].replace(/^@/, "").toLowerCase();
  // Paths that aren't profiles.
  if (["home", "i", "search", "explore", "intent", "share", "hashtag"].includes(handle)) return null;
  return `https://x.com/${handle}`;
}

/**
 * The author's profile from a LinkedIn link: a profile URL as-is, or a post URL
 * ("linkedin.com/posts/jane-doe_launch-day-activity-123") read as "linkedin.com/in/jane-doe".
 */
export function linkedInProfile(url: string | null | undefined): string | null {
  const post = url?.match(/linkedin\.com\/posts\/([^_/?#]+)_/i);
  return post ? normaliseLinkedIn(`linkedin.com/in/${post[1]}`) : normaliseLinkedIn(url);
}

const simplify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Company names and domains compared loosely: "Acme, Inc." = "acme" = "acme.io". */
function companyKey(s: string) {
  const host = hostOf(s);
  const base = host ? host.split(".")[0] : s;
  return simplify(base).replace(/\b(inc|llc|ltd|labs?|hq|ai|technologies|technology|co)\b/g, "").replace(/\s/g, "");
}

export function matchAccount(company: string | null | undefined, accounts: KamAccount[]): KamAccount | null {
  if (!company?.trim()) return null;
  const key = companyKey(company);
  if (!key) return null;
  const hits = accounts.filter(
    (a) => companyKey(a.company) === key || (a.domain && companyKey(a.domain) === key) || (a.website && companyKey(a.website) === key),
  );
  return hits.length === 1 ? hits[0] : null;
}

/** "Jane" matches "Jane Doe"; "Jane Doe" matches "jane doe". */
function nameMatches(said: string, full: string) {
  const a = simplify(said);
  const b = simplify(full);
  if (!a || !b) return false;
  if (a === b) return true;
  const saidParts = a.split(" ");
  const fullParts = b.split(" ");
  return saidParts.every((p) => fullParts.includes(p));
}

export interface PersonRef {
  name?: string | null;
  company?: string | null;
  link?: string | null;
}

/**
 * The stakeholder a touch is about: by LinkedIn / X profile link first, then by name within the
 * matched account, then among `ownerId`'s own stakeholders (each member works their own POCs),
 * then across everyone's. Null when it isn't clear-cut.
 */
export function matchStakeholder(
  ref: PersonRef,
  stakeholders: KamStakeholder[],
  accounts: KamAccount[],
  ownerId?: string | null,
): KamStakeholder | null {
  const linkedin = linkedInProfile(ref.link);
  if (linkedin) {
    const hit = stakeholders.find((s) => linkedInProfile(s.linkedinUrl) === linkedin);
    if (hit) return hit;
  }
  const x = normaliseX(ref.link);
  if (x) {
    const hit = stakeholders.find((s) => normaliseX(s.xUrl) === x);
    if (hit) return hit;
  }
  if (!ref.name?.trim()) return null;

  const account = matchAccount(ref.company, accounts);
  const byName = (pool: KamStakeholder[]) => pool.filter((s) => nameMatches(ref.name!, s.name));
  if (account) {
    const hits = byName(stakeholders.filter((s) => s.accountId === account.id));
    return hits.length === 1 ? hits[0] : null;
  }
  if (ownerId) {
    const own = byName(stakeholders.filter((s) => s.ownerId === ownerId));
    if (own.length === 1) return own[0];
    if (own.length > 1) return null;
  }
  const hits = byName(stakeholders);
  return hits.length === 1 ? hits[0] : null;
}

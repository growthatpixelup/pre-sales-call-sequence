import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { linkedInProfile, matchAccount, matchStakeholder, normaliseX } from "../lib/kam/match";
import { touchesBeforeReply } from "../lib/kam/metrics";
import type { KamAccount, KamActivity, KamStakeholder } from "../lib/kam/types";

const account = (id: string, company: string, domain: string | null = null): KamAccount => ({
  id,
  company,
  domain,
  website: null,
  ownerId: null,
  status: "active",
  notes: "",
  createdAt: "2026-11-01T00:00:00Z",
});

const person = (id: string, accountId: string, name: string, extra: Partial<KamStakeholder> = {}): KamStakeholder => ({
  id,
  accountId,
  name,
  role: null,
  linkedinUrl: null,
  xUrl: null,
  stage: "identified",
  ownerId: null,
  leadId: null,
  notes: "",
  lastTouchAt: null,
  createdAt: "2026-11-01T00:00:00Z",
  ...extra,
});

const accounts = [account("a1", "Acme, Inc.", "acme.io"), account("a2", "Linear")];
const people = [
  person("p1", "a1", "Jane Doe", { linkedinUrl: "https://www.linkedin.com/in/jane-doe" }),
  person("p2", "a1", "Sam Lee", { xUrl: "https://x.com/samlee" }),
  person("p3", "a2", "Jane Park"),
];

describe("link normalising", () => {
  it("reads X profiles from profile and post links", () => {
    assert.equal(normaliseX("https://twitter.com/SamLee/status/123"), "https://x.com/samlee");
    assert.equal(normaliseX("x.com/@samlee"), "https://x.com/samlee");
    assert.equal(normaliseX("https://x.com/home"), null);
  });

  it("reads the author's profile from a LinkedIn post link", () => {
    assert.equal(linkedInProfile("https://www.linkedin.com/posts/jane-doe_launch-day-activity-123"), "https://www.linkedin.com/in/jane-doe");
  });
});

describe("matchAccount", () => {
  it("matches loosely on name or domain", () => {
    assert.equal(matchAccount("acme", accounts)?.id, "a1");
    assert.equal(matchAccount("acme.io", accounts)?.id, "a1");
    assert.equal(matchAccount("LINEAR", accounts)?.id, "a2");
    assert.equal(matchAccount("Vercel", accounts), null);
  });
});

describe("matchStakeholder", () => {
  it("matches on profile links first", () => {
    assert.equal(matchStakeholder({ name: "someone", link: "https://linkedin.com/posts/jane-doe_x-activity-1" }, people, accounts)?.id, "p1");
    assert.equal(matchStakeholder({ link: "https://x.com/samlee/status/9" }, people, accounts)?.id, "p2");
  });

  it("matches names within the company, and only when unambiguous", () => {
    assert.equal(matchStakeholder({ name: "Jane", company: "Linear" }, people, accounts)?.id, "p3");
    assert.equal(matchStakeholder({ name: "jane doe" }, people, accounts)?.id, "p1");
    // Two Janes and no company: not a match.
    assert.equal(matchStakeholder({ name: "Jane" }, people, accounts), null);
    assert.equal(matchStakeholder({ name: "Priya" }, people, accounts), null);
  });

  it("prefers the poster's own stakeholders when a name is ambiguous", () => {
    const owned = people.map((p) => (p.id === "p3" ? { ...p, ownerId: "arjun" } : { ...p, ownerId: "daksh" }));
    assert.equal(matchStakeholder({ name: "Jane" }, owned, accounts, "arjun")?.id, "p3");
    assert.equal(matchStakeholder({ name: "Jane" }, owned, accounts, "monesh"), null);
  });
});

describe("touchesBeforeReply", () => {
  const touch = (id: number, day: string, type: KamActivity["type"], count = 1) =>
    ({ id, day, type, count }) as KamActivity;

  it("counts touches before the first reply", () => {
    assert.equal(
      touchesBeforeReply([touch(3, "2026-11-03", "dm"), touch(1, "2026-11-01", "like", 3), touch(4, "2026-11-04", "reply"), touch(5, "2026-11-05", "dm")]),
      4,
    );
  });

  it("is null without a reply", () => {
    assert.equal(touchesBeforeReply([touch(1, "2026-11-01", "comment")]), null);
  });
});

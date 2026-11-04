import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { companyDomain, hostOf, normaliseLinkedIn, pickMatch, type MatchCandidate } from "../../lib/leads/dedup";

const lead = (id: string, fields: Partial<MatchCandidate>, updatedAt = "2026-11-01T00:00:00Z"): MatchCandidate => ({
  id,
  email: null,
  linkedinUrl: null,
  domain: null,
  updatedAt,
  ...fields,
});

describe("companyDomain", () => {
  it("takes the domain from a work email", () => {
    assert.equal(companyDomain("Jane@Acme.io"), "acme.io");
  });

  it("ignores free-mail domains and falls back to the website", () => {
    assert.equal(companyDomain("jane@gmail.com"), null);
    assert.equal(companyDomain("jane@gmail.com", "https://www.acme.io/about"), "acme.io");
  });
});

describe("normalisers", () => {
  it("normalises LinkedIn profile URLs", () => {
    assert.equal(normaliseLinkedIn("linkedin.com/in/Jane-Doe/?utm_source=x"), "https://www.linkedin.com/in/jane-doe");
    assert.equal(normaliseLinkedIn("https://example.com"), null);
  });

  it("reads hosts from bare domains and URLs", () => {
    assert.equal(hostOf("acme.io"), "acme.io");
    assert.equal(hostOf("http://www.acme.io/x"), "acme.io");
    assert.equal(hostOf("not a url"), null);
  });
});

describe("pickMatch", () => {
  const candidates = [
    lead("by-email", { email: "Jane@Acme.io", domain: "acme.io" }),
    lead("by-linkedin", { linkedinUrl: "https://www.linkedin.com/in/jane-doe" }),
    lead("by-domain-old", { domain: "acme.io" }, "2026-10-01T00:00:00Z"),
    lead("by-domain-new", { domain: "beta.dev" }, "2026-11-02T00:00:00Z"),
    lead("by-domain-older", { domain: "beta.dev" }, "2026-10-02T00:00:00Z"),
  ];

  it("matches on email first, case-insensitively", () => {
    const m = pickMatch({ email: "jane@acme.io", linkedinUrl: "linkedin.com/in/jane-doe" }, candidates);
    assert.deepEqual([m?.lead.id, m?.on], ["by-email", "email"]);
  });

  it("then on LinkedIn URL", () => {
    const m = pickMatch({ email: "other@x.com", linkedinUrl: "https://linkedin.com/in/JANE-DOE/" }, candidates);
    assert.deepEqual([m?.lead.id, m?.on], ["by-linkedin", "linkedin"]);
  });

  it("then on domain, newest lead first", () => {
    const m = pickMatch({ domain: "beta.dev" }, candidates);
    assert.deepEqual([m?.lead.id, m?.on], ["by-domain-new", "domain"]);
  });

  it("returns null when nothing matches", () => {
    assert.equal(pickMatch({ email: "nobody@nowhere.com" }, candidates), null);
    assert.equal(pickMatch({}, candidates), null);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Lead } from "../../lib/leads/types";
import { filterXLeads, parseXOrigin, summariseXLeads, toXLeads } from "../../lib/leads/x-leads";

const lead = (id: string, fields: Partial<Lead> = {}): Lead => ({
  id,
  contactName: "",
  company: null,
  role: null,
  email: null,
  linkedinUrl: null,
  domain: null,
  fundingStage: null,
  icpFit: null,
  origin: "x_outreach",
  originDetail: null,
  bookingSource: null,
  owner: null,
  stage: "engaged",
  stageChangedAt: null,
  exitReason: null,
  dealType: "project",
  parentLeadId: null,
  estimatedPrice: null,
  closedPrice: null,
  nextAction: null,
  nextActionDue: null,
  lastTouchAt: null,
  proposalUrl: null,
  transcriptUrl: null,
  notes: "",
  winNote: null,
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
  ...fields,
});

describe("parseXOrigin", () => {
  it("reads the source and handle", () => {
    assert.deepEqual(parseXOrigin("lead_radar:@Jane_Doe"), { source: "lead_radar", handle: "Jane_Doe" });
    assert.deepEqual(parseXOrigin("dm_pipeline: @acme"), { source: "dm_pipeline", handle: "acme" });
    assert.deepEqual(parseXOrigin("dm_pipeline:acme"), { source: "dm_pipeline", handle: "acme" });
  });

  it("keeps the handle when the source is unknown, and gives up on anything else", () => {
    assert.deepEqual(parseXOrigin("other:@jane"), { source: null, handle: "jane" });
    assert.deepEqual(parseXOrigin("Found on X"), { source: null, handle: null });
    assert.deepEqual(parseXOrigin(null), { source: null, handle: null });
  });
});

describe("X lead list", () => {
  const rows = toXLeads([
    lead("a", { contactName: "Jane", company: "Acme", originDetail: "lead_radar:@jane", lastTouchAt: "2026-11-03T00:00:00Z" }),
    lead("b", { contactName: "Raj", originDetail: "dm_pipeline:@rajbuilds", stage: "call_booked", createdAt: "2026-11-04T00:00:00Z" }),
    lead("c", { contactName: "Old", originDetail: "lead_radar:@old", createdAt: "2026-10-01T00:00:00Z" }),
    lead("d", { contactName: "Cal person", origin: "cal" }),
  ]);

  it("keeps only x_outreach leads", () => {
    assert.deepEqual(rows.map((r) => r.lead.id).sort(), ["a", "b", "c"]);
  });

  it("filters by source, stage and search over name, company and handle", () => {
    const base = { q: "", source: "all", stage: "all" };
    assert.deepEqual(filterXLeads(rows, { ...base, source: "dm_pipeline" }).map((r) => r.lead.id), ["b"]);
    assert.deepEqual(filterXLeads(rows, { ...base, stage: "engaged" }).map((r) => r.lead.id), ["a", "c"]);
    assert.deepEqual(filterXLeads(rows, { ...base, q: "acme" }).map((r) => r.lead.id), ["a"]);
    assert.deepEqual(filterXLeads(rows, { ...base, q: "@rajb" }).map((r) => r.lead.id), ["b"]);
  });

  it("sorts by last touch, falling back to when the lead was added", () => {
    assert.deepEqual(filterXLeads(rows, { q: "", source: "all", stage: "all" }).map((r) => r.lead.id), ["b", "a", "c"]);
  });

  it("summarises totals, stages and the last 7 days", () => {
    const s = summariseXLeads(rows, Date.parse("2026-11-05T00:00:00Z"));
    assert.equal(s.total, 3);
    assert.equal(s.lastWeek, 2);
    assert.deepEqual(s.byStage, [
      { stage: "engaged", count: 2 },
      { stage: "call_booked", count: 1 },
    ]);
  });
});

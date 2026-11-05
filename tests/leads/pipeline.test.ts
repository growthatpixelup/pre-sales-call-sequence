import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Booking } from "../../lib/bookings/types";
import { buildPipeline, enrichLeads } from "../../lib/leads/pipeline";
import type { Lead, Stage } from "../../lib/leads/types";

const NOW = Date.parse("2026-11-05T12:00:00Z");

const lead = (id: string, stage: Stage, fields: Partial<Lead> = {}): Lead =>
  ({
    id, contactName: id, company: null, role: null, email: null, linkedinUrl: null, domain: null, fundingStage: null, icpFit: null,
    origin: "cal", originDetail: null, bookingSource: null, owner: null, stage, stageChangedAt: "2026-11-01T00:00:00Z", exitReason: null,
    dealType: "project", parentLeadId: null, estimatedPrice: null, closedPrice: null, nextAction: null, nextActionDue: null,
    lastTouchAt: null, proposalUrl: null, transcriptUrl: null, notes: "", winNote: null,
    createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", ...fields,
  }) as Lead;

const booking = (leadId: string, start: string, status = "accepted", range: string | null = "$10k - $15k"): Booking =>
  ({
    id: `b-${leadId}-${start}`, leadId, startTime: start, endTime: new Date(Date.parse(start) + 30 * 60_000).toISOString(),
    bookingStatus: status, investmentRange: range, legacy: { budget: null, topic: null },
  }) as unknown as Booking;

describe("pipeline", () => {
  const leads = [
    lead("past", "call_booked"),
    lead("future", "call_booked"),
    lead("cancelled", "call_booked"),
    lead("held", "call_held"),
    lead("paid", "paid", { closedPrice: 20000, origin: "referral" }),
    lead("lost", "lost"),
    lead("new", "engaged", { origin: "x_outreach" }),
  ];
  const bookings = [
    booking("past", "2026-10-20T10:00:00Z"),
    booking("future", "2026-11-09T10:00:00Z"),
    booking("cancelled", "2026-10-25T10:00:00Z", "cancelled"),
  ];
  const view = buildPipeline(enrichLeads(leads, bookings, NOW), NOW);

  it("splits Call booked by what happened to the call", () => {
    assert.deepEqual(view.needsOutcome.map((p) => p.lead.id), ["past"]);
    assert.deepEqual(view.upcoming.map((p) => p.lead.id), ["future"]);
    assert.deepEqual(view.cancelled.map((p) => p.lead.id), ["cancelled"]);
  });

  it("values leads from price, else their investment range", () => {
    const past = enrichLeads(leads, bookings, NOW).find((p) => p.lead.id === "past")!;
    assert.deepEqual([past.value, past.valueKind], [12500, "range"]);
    assert.equal(view.won.revenue, 20000);
  });

  it("counts how far leads got and the conversions between stages", () => {
    const reached = Object.fromEntries(view.funnel.map((s) => [s.stage, s.reached]));
    assert.deepEqual([reached.engaged, reached.call_booked, reached.call_held, reached.paid], [6, 5, 2, 1]);
    assert.equal(view.conversions.find((c) => c.from === "call_booked")?.rate, 0.4);
    assert.equal(view.winRate, 0.5);
    assert.deepEqual(view.bySource.map((r) => [r.origin, r.leads, r.won]), [["cal", 5, 0], ["x_outreach", 1, 0], ["referral", 1, 1]]);
  });
});

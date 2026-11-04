import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fromAnswer } from "../../lib/leads/attribution";

describe("fromAnswer", () => {
  it("maps answers that name a channel", () => {
    assert.deepEqual(fromAnswer("Y Combinator Referral"), { origin: "referral", detail: "YC network" });
    assert.deepEqual(fromAnswer("Past Client"), { origin: "referral", detail: "Past client" });
    assert.deepEqual(fromAnswer("AI search (Claude, Chatgpt)"), { origin: "inbound", detail: "AI search" });
    assert.deepEqual(fromAnswer("Google search"), { origin: "inbound", detail: "Google search" });
    assert.deepEqual(fromAnswer("Contra"), { origin: "contra", detail: "Contra" });
  });

  it("leaves ambiguous or empty answers unknown", () => {
    assert.equal(fromAnswer("LinkedIN"), null);
    assert.equal(fromAnswer("X/Twitter"), null);
    assert.equal(fromAnswer("Other"), null);
    assert.equal(fromAnswer(null), null);
    assert.equal(fromAnswer("  "), null);
  });
});

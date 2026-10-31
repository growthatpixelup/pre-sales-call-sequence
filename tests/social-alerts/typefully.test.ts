import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { handleTypefullyWebhook, verifyTypefullySignature } from "../../lib/social-alerts/typefully";
import { memoryStore, recorder } from "./helpers";

const SECRET = "test-secret";
const NOW = 1_800_000_000_000; // ms

function sign(rawBody: string, timestamp: string, secret = SECRET) {
  return "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

const rawBody = JSON.stringify({
  event: "draft.published",
  data: {
    id: 4242,
    preview: "Shipping a new landing page teardown today",
    x_published_url: "https://x.com/pixeluplabs/status/1900000000000000001",
    linkedin_published_url: null,
  },
});
const ts = String(NOW / 1000);

describe("verifyTypefullySignature", () => {
  it("accepts a valid signature", () => {
    assert.equal(verifyTypefullySignature({ rawBody, timestamp: ts, signature: sign(rawBody, ts), secret: SECRET, now: NOW }), true);
  });

  it("rejects a tampered body", () => {
    const tampered = rawBody.replace("pixeluplabs", "someoneelse");
    assert.equal(verifyTypefullySignature({ rawBody: tampered, timestamp: ts, signature: sign(rawBody, ts), secret: SECRET, now: NOW }), false);
  });

  it("rejects a signature made with the wrong secret", () => {
    assert.equal(
      verifyTypefullySignature({ rawBody, timestamp: ts, signature: sign(rawBody, ts, "wrong"), secret: SECRET, now: NOW }),
      false,
    );
  });

  it("rejects a stale timestamp (> 5 minutes old), even if correctly signed", () => {
    const old = String(NOW / 1000 - 301);
    assert.equal(verifyTypefullySignature({ rawBody, timestamp: old, signature: sign(rawBody, old), secret: SECRET, now: NOW }), false);
    const recent = String(NOW / 1000 - 299);
    assert.equal(verifyTypefullySignature({ rawBody, timestamp: recent, signature: sign(rawBody, recent), secret: SECRET, now: NOW }), true);
  });

  it("rejects missing headers and a bare hex signature without the sha256= prefix", () => {
    assert.equal(verifyTypefullySignature({ rawBody, timestamp: null, signature: sign(rawBody, ts), secret: SECRET, now: NOW }), false);
    assert.equal(verifyTypefullySignature({ rawBody, timestamp: ts, signature: null, secret: SECRET, now: NOW }), false);
    const bare = sign(rawBody, ts).slice("sha256=".length);
    assert.equal(verifyTypefullySignature({ rawBody, timestamp: ts, signature: bare, secret: SECRET, now: NOW }), false);
  });
});

describe("handleTypefullyWebhook", () => {
  const headers = { timestamp: ts, signature: sign(rawBody, ts), event: "draft.published" };

  it("posts one alert, and the same draft sent twice produces only one alert", async () => {
    const { store, rows } = memoryStore();
    const slack = recorder();
    const deps = { secret: SECRET, now: NOW, store, notify: slack.notify };

    const first = await handleTypefullyWebhook(rawBody, headers, deps);
    const second = await handleTypefullyWebhook(rawBody, headers, deps);

    assert.equal(first.status, 200);
    assert.deepEqual(first.body.results, { x: "sent" });
    assert.equal(second.status, 200);
    assert.deepEqual(second.body.results, { x: "duplicate" });
    assert.equal(slack.sent.length, 1);
    assert.equal(rows.size, 1);
    assert.equal([...rows.values()][0].external_id, "4242:x");

    assert.equal(
      slack.sent[0],
      ':large_green_circle: *New post live on X* · @pixeluplabs\n_"Shipping a new landing page teardown today"_\nhttps://x.com/pixeluplabs/status/1900000000000000001',
    );
  });

  it("returns 401 on a bad signature and does nothing", async () => {
    const { store, rows } = memoryStore();
    const slack = recorder();
    const res = await handleTypefullyWebhook(rawBody, { ...headers, signature: sign(rawBody, ts, "wrong") }, { secret: SECRET, now: NOW, store, notify: slack.notify });
    assert.equal(res.status, 401);
    assert.equal(rows.size, 0);
    assert.equal(slack.sent.length, 0);
  });

  it("ignores draft.status_changed with 200", async () => {
    const body = JSON.stringify({ event: "draft.status_changed", data: { id: 1, x_published_url: "https://x.com/a/status/1" } });
    const slack = recorder();
    const res = await handleTypefullyWebhook(
      body,
      { timestamp: ts, signature: sign(body, ts), event: "draft.status_changed" },
      { secret: SECRET, now: NOW, ...memoryStore(), notify: slack.notify },
    );
    assert.equal(res.status, 200);
    assert.equal(slack.sent.length, 0);
  });

  it("returns 500 and releases the row when Slack fails, so Typefully's retry posts it", async () => {
    const { store, rows } = memoryStore();
    const failing = { secret: SECRET, now: NOW, store, notify: async () => { throw new Error("slack down"); } };
    const originalError = console.error;
    console.error = () => {};
    try {
      const res = await handleTypefullyWebhook(rawBody, headers, failing);
      assert.equal(res.status, 500);
    } finally {
      console.error = originalError;
    }
    assert.equal(rows.size, 0);

    const slack = recorder();
    const retry = await handleTypefullyWebhook(rawBody, headers, { secret: SECRET, now: NOW, store, notify: slack.notify });
    assert.equal(retry.status, 200);
    assert.equal(slack.sent.length, 1);
  });

  it("alerts X (article fallback) and LinkedIn separately", async () => {
    const body = JSON.stringify({
      event: "draft.published",
      data: {
        id: "d1",
        preview: "x".repeat(100),
        x_published_url: null,
        x_article_published_url: "https://x.com/dakshpixelup/status/42",
        linkedin_published_url: "https://www.linkedin.com/feed/update/urn:li:activity:1/",
      },
    });
    const { store, rows } = memoryStore();
    const slack = recorder();
    const res = await handleTypefullyWebhook(body, { timestamp: ts, signature: sign(body, ts), event: null }, { secret: SECRET, now: NOW, store, notify: slack.notify });
    assert.equal(res.status, 200);
    assert.deepEqual([...rows.values()].map((r) => r.external_id).sort(), ["d1:linkedin", "d1:x"]);
    assert.match(slack.sent[0], /New post live on X\* · @dakshpixelup/);
    assert.match(slack.sent[0], /_"x{80}…"_/);
    assert.match(slack.sent[1], /^:large_green_circle: \*New post live on LinkedIn\*\n/);
  });
});

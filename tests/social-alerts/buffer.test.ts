import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pollBufferSent } from "../../lib/social-alerts/buffer";
import { memoryStore, recorder } from "./helpers";

const config = { apiKey: "buffer-key", orgId: "org1", channelIds: "chanA, chanB" };

type Node = { id: string; text: string; sentAt: string; externalLink: string | null; channelId: string };

/** Fake Buffer GraphQL endpoint. Posts are newest first, like the real query. */
function bufferApi(posts: Node[], init?: { status?: number; headers?: Record<string, string>; body?: unknown }) {
  const calls: { url: string; auth: string | null; query: string }[] = [];
  const fetchImpl = (async (url: string, req: RequestInit) => {
    const headers = new Headers(req.headers);
    calls.push({ url, auth: headers.get("authorization"), query: JSON.parse(String(req.body)).query });
    const body = init?.body ?? {
      data: {
        posts: { edges: posts.map((node) => ({ node })) },
        channels: [
          { id: "chanA", name: "pixelup-labs", displayName: "PixelUp Labs", service: "linkedin" },
          { id: "chanB", name: "daksh", displayName: null, service: "linkedin" },
        ],
      },
    };
    return new Response(JSON.stringify(body), { status: init?.status ?? 200, headers: init?.headers });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const post = (id: string, link: string | null, channelId = "chanA"): Node => ({
  id,
  text: `Post ${id} text`,
  sentAt: "2026-10-31T10:00:00Z",
  externalLink: link,
  channelId,
});

describe("pollBufferSent", () => {
  it("first run seeds existing sent posts without posting to Slack", async () => {
    const { store, rows } = memoryStore();
    const slack = recorder();
    const api = bufferApi([post("p2", "https://www.linkedin.com/feed/update/2"), post("p1", "https://www.linkedin.com/feed/update/1")]);

    const res = await pollBufferSent(config, { store, notify: slack.notify, fetch: api.fetchImpl });

    assert.equal(res.status, 200);
    assert.equal(res.body.firstRun, true);
    assert.equal(slack.sent.length, 0);
    assert.deepEqual([...rows.values()].map((r) => r.external_id).sort(), ["p1", "p2"]);

    // Sends the key, the org and both channel ids.
    assert.equal(api.calls[0].url, "https://api.buffer.com");
    assert.equal(api.calls[0].auth, "Bearer buffer-key");
    assert.match(api.calls[0].query, /organizationId: "org1"/);
    assert.match(api.calls[0].query, /channelIds: \["chanA", "chanB"\]/);
    assert.match(api.calls[0].query, /status: \[sent\]/);
  });

  it("later runs alert only new posts, skip null externalLink, and pick it up once the link appears", async () => {
    const { store } = memoryStore();
    const slack = recorder();
    await store.markSeen([{ source: "buffer", platform: "linkedin", external_id: "p1", url: "https://www.linkedin.com/feed/update/1" }]);

    const pending = bufferApi([
      post("p3", null, "chanB"),
      post("p2", "https://www.linkedin.com/feed/update/2"),
      post("p1", "https://www.linkedin.com/feed/update/1"),
    ]);
    const res = await pollBufferSent(config, { store, notify: slack.notify, fetch: pending.fetchImpl });

    assert.equal(res.status, 200);
    assert.deepEqual(res.body.results, { p2: "sent", p1: "duplicate" });
    assert.equal(res.body.pendingLink, 1);
    assert.equal(slack.sent.length, 1);
    assert.equal(
      slack.sent[0],
      ':large_green_circle: *New post live on LinkedIn* · PixelUp Labs\n_"Post p2 text"_\nhttps://www.linkedin.com/feed/update/2',
    );

    // Next run: p3 now has its link.
    const ready = bufferApi([
      post("p3", "https://www.linkedin.com/feed/update/3", "chanB"),
      post("p2", "https://www.linkedin.com/feed/update/2"),
    ]);
    await pollBufferSent(config, { store, notify: slack.notify, fetch: ready.fetchImpl });
    assert.equal(slack.sent.length, 2);
    assert.match(slack.sent[1], /LinkedIn\* · daksh\n/);
  });

  it("on HTTP 429 logs retryAfter and exits 200 without retrying", async () => {
    const { store } = memoryStore();
    const slack = recorder();
    const api = bufferApi([], {
      status: 429,
      headers: { "Retry-After": "753" },
      body: { errors: [{ message: "Too many requests", extensions: { code: "RATE_LIMIT_EXCEEDED", window: "15m" } }] },
    });
    const warn = console.warn;
    const logged: unknown[] = [];
    console.warn = (...args) => void logged.push(args.join(" "));
    try {
      const res = await pollBufferSent(config, { store, notify: slack.notify, fetch: api.fetchImpl });
      assert.equal(res.status, 200);
      assert.equal(res.body.retryAfter, "753");
    } finally {
      console.warn = warn;
    }
    assert.equal(api.calls.length, 1);
    assert.match(String(logged[0]), /retryAfter=753/);
  });

  it("treats GraphQL errors in a 200 response as a failure", async () => {
    const { store } = memoryStore();
    const api = bufferApi([], { body: { errors: [{ message: "Cannot query field \"foo\"" }] } });
    const error = console.error;
    console.error = () => {};
    try {
      const res = await pollBufferSent(config, { store, notify: recorder().notify, fetch: api.fetchImpl });
      assert.equal(res.status, 502);
    } finally {
      console.error = error;
    }
  });

  it("refuses to run without config, naming the missing variables only", async () => {
    const res = await pollBufferSent({ apiKey: undefined, orgId: "o", channelIds: " " }, { ...memoryStore(), notify: recorder().notify });
    assert.equal(res.status, 500);
    assert.equal(res.body.error, "Not configured: BUFFER_API_KEY, BUFFER_LINKEDIN_CHANNEL_IDS");
  });
});

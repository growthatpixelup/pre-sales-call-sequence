import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleRpc, toolList, type McpData } from "../../lib/content/mcp";
import type { Post, Swipe } from "../../lib/content/types";

const now = new Date("2026-11-05T12:00:00Z");

const post = (id: string, fields: Partial<Post> = {}): Post => ({
  id,
  platform: "x",
  url: `https://x.com/ann/status/${id}`,
  author: { name: "Ann", handle: "ann", avatarUrl: null },
  text: `text ${id}`,
  thread: [],
  quoted: null,
  media: [],
  metrics: { views: 100, likes: 1, comments: 1, reposts: 1, saves: 1 },
  publishedAt: "2026-11-01T10:00:00Z",
  outlier: null,
  ...fields,
});

const analysis = (hookPattern: string, format = "Single post") => ({
  hook: `hook ${hookPattern}`, hookPattern, format, whyItWorks: ["w"], skeleton: ["s"], pillar: "B2C", borrow: "b", design: false, confidence: "high" as const,
});

const swipe = (id: string, fields: Partial<Swipe>): Swipe => ({ ...post(id), savedAt: "2026-11-02T00:00:00Z", analysis: null, ...fields });

const swipes: Swipe[] = [
  swipe("a", { outlier: 5, analysis: analysis("Mini-study"), thread: ["1", "2", "3", "4", "5"] }),
  swipe("b", { outlier: 3, analysis: analysis("mini-study", "Thread"), platform: "linkedin" }),
  swipe("c", { outlier: 1.1, analysis: analysis("Big claim") }),
  swipe("d", { outlier: 4, publishedAt: "2026-08-01T00:00:00Z" }),
];

const data: McpData = {
  swipes: async () => ({ status: "ok", data: { swipes, runs: [] } }),
  analytics: async (p) =>
    p === "x"
      ? { status: "ok", data: { daily: [], sources: [], since: null, posts: [post("m1", { outlier: 2.5 }), post("m2", { outlier: 0.8 })] } }
      : { status: "not_connected", source: "LinkedIn analytics", missing: ["an analytics export"] },
};

const call = async (name: string, args: object = {}) => {
  const res = (await handleRpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, data, now)) as {
    result: { isError?: boolean; structuredContent?: Record<string, unknown>; content: { text: string }[] };
  };
  return res.result;
};

describe("content MCP", () => {
  it("initializes, echoing a supported protocol version", async () => {
    const res = (await handleRpc({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18" } }, data)) as {
      result: { protocolVersion: string; capabilities: object };
    };
    assert.equal(res.result.protocolVersion, "2025-06-18");
    assert.ok("tools" in res.result.capabilities);
  });

  it("ignores notifications and rejects unknown methods", async () => {
    assert.equal(await handleRpc({ jsonrpc: "2.0", method: "notifications/initialized" }, data), null);
    const res = (await handleRpc({ jsonrpc: "2.0", id: 2, method: "nope" }, data)) as { error: { code: number } };
    assert.equal(res.error.code, -32601);
  });

  it("lists tools with JSON schemas", () => {
    const tools = toolList();
    assert.deepEqual(tools.map((t) => t.name), ["list_outliers", "get_swipe", "hook_patterns", "my_outliers"]);
    assert.equal((tools[0].inputSchema as { type: string }).type, "object");
    assert.ok(!("$schema" in tools[0].inputSchema));
  });

  it("lists outliers above the threshold, biggest first, with filters", async () => {
    const all = (await call("list_outliers")).structuredContent as { swipes: { id: string; thread: string[]; thread_more?: number }[] };
    assert.deepEqual(all.swipes.map((s) => s.id), ["a", "d", "b"]);
    assert.equal(all.swipes[0].thread.length, 3);
    assert.equal(all.swipes[0].thread_more, 2);
    const recent = (await call("list_outliers", { since_days: 30, hook_pattern: "MINI", platform: "x" })).structuredContent as { swipes: { id: string }[] };
    assert.deepEqual(recent.swipes.map((s) => s.id), ["a"]);
    const analyzed = (await call("list_outliers", { analyzed_only: true, min_outlier: 0 })).structuredContent as { total: number };
    assert.equal(analyzed.total, 3);
  });

  it("groups hook patterns case-insensitively, best median first", async () => {
    const r = (await call("hook_patterns")).structuredContent as { groups: { hook_pattern: string; posts: number; median_outlier: number }[] };
    assert.deepEqual(r.groups.map((g) => [g.hook_pattern, g.posts, g.median_outlier]), [["Mini-study", 2, 4], ["Big claim", 1, 1.1]]);
  });

  it("finds a swipe by url and returns it in full", async () => {
    const r = (await call("get_swipe", { url: "https://twitter.com/ann/status/a?s=20" })).structuredContent as { id: string; thread: string[] };
    assert.equal(r.id, "a");
    assert.equal(r.thread.length, 5);
    assert.equal((await call("get_swipe", { id: "zzz" })).isError, true);
    assert.equal((await call("get_swipe", {})).isError, true);
  });

  it("returns Daksh's own outliers and says which platform is missing", async () => {
    const r = (await call("my_outliers")).structuredContent as { posts: { id: string }[]; unavailable: string[] };
    assert.deepEqual(r.posts.map((p) => p.id), ["m1"]);
    assert.match(r.unavailable[0], /LinkedIn analytics is not connected/);
  });

  it("reports bad arguments as a tool error", async () => {
    const r = await call("list_outliers", { limit: 500 });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /Invalid arguments/);
  });
});

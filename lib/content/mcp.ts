/**
 * Content OS over MCP: lets Claude (Desktop, claude.ai, Claude Code) read the swipe file's outliers
 * and Daksh's own best posts, to borrow hooks and formats. Read-only.
 *
 * A minimal stateless MCP server (Streamable HTTP transport, plain JSON responses, no sessions).
 * Pure: data comes in through `McpData`, so tests run without Supabase. The route lives at
 * app/api/mcp/route.ts.
 */

import * as z from "zod";
import { median } from "./analytics";
import { matchesMedia } from "./swipes";
import { MEDIA_FILTERS, PLATFORMS, type Platform, type PlatformAnalytics, type Post, type SourceResult, type Swipe, type SwipeFile } from "./types";

export interface McpData {
  swipes: () => Promise<SourceResult<SwipeFile>>;
  analytics: (platform: Platform) => Promise<SourceResult<PlatformAnalytics>>;
}

const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS = `Content OS for Daksh (X @dakshpixelup and LinkedIn). Two data sets:
1. The swipe file: other creators' posts Daksh bookmarked, each scored by outlier_score (views ÷ that author's median post views; 3.4 = 3.4× a typical post) and broken down into hook, hook pattern, format, why it works, skeleton and what to borrow.
2. Daksh's own published posts with the same outlier score against his own median.
To write hooks or pick a format: call hook_patterns to see which patterns over-perform, then list_outliers (filter by hook_pattern / format / pillar) for concrete examples, and my_outliers to see what already works for Daksh's audience. Borrow structure, never copy text.`;

// ---------- Tools ----------

const platformArg = z.enum([...PLATFORMS, "both"]).default("both").describe("x, linkedin or both");
const limitArg = (def: number) => z.number().int().min(1).max(100).default(def).describe(`How many to return (max 100, default ${def})`);
const sinceArg = z.number().int().min(1).optional().describe("Only posts published in the last N days");

const listOutliersArgs = z.object({
  platform: platformArg,
  min_outlier: z.number().min(0).default(2).describe("Minimum outlier score (default 2 = 2× the author's typical post)"),
  pillar: z.string().optional().describe("Content pillar, e.g. 'B2B & AI', 'B2C', 'Growth & brand', 'Commentary'"),
  hook_pattern: z.string().optional().describe("Hook pattern to match (case-insensitive substring), e.g. 'Mini-study'"),
  format: z.string().optional().describe("Format to match (case-insensitive substring), e.g. 'Thread', 'Single post', 'Carousel'"),
  search: z.string().optional().describe("Words to find in the post text or hook (case-insensitive)"),
  media: z.enum(MEDIA_FILTERS).default("any").describe("any, images, video, text (no media), design (design is the point)"),
  since_days: sinceArg,
  analyzed_only: z.boolean().default(false).describe("Only posts that already have a hook/format breakdown"),
  sort: z.enum(["outlier", "newest"]).default("outlier"),
  limit: limitArg(20),
});

const getSwipeArgs = z
  .object({ id: z.string().optional().describe("Swipe id from list_outliers"), url: z.string().optional().describe("The post's URL") })
  .refine((a) => a.id || a.url, "Pass id or url");

const hookPatternsArgs = z.object({
  platform: platformArg,
  group_by: z.enum(["hook_pattern", "format", "pillar"]).default("hook_pattern"),
  since_days: sinceArg,
  examples: z.number().int().min(0).max(10).default(3).describe("Top examples per group (default 3)"),
});

const myOutliersArgs = z.object({
  platform: platformArg,
  min_outlier: z.number().min(0).default(1.5).describe("Minimum outlier score against Daksh's own median (default 1.5)"),
  since_days: sinceArg,
  limit: limitArg(15),
});

type Handler = (args: unknown, data: McpData, now: Date) => Promise<unknown>;

interface Tool {
  name: string;
  title: string;
  description: string;
  schema: z.ZodType;
  run: Handler;
}

const TOOLS: Tool[] = [
  {
    name: "list_outliers",
    title: "Swipe-file outliers",
    description:
      "Posts from the swipe file (other creators' bookmarked posts) that beat their author's typical post, with full text, metrics and the hook/format breakdown. Use for hook and format inspiration.",
    schema: listOutliersArgs,
    run: async (raw, data, now) => {
      const a = listOutliersArgs.parse(raw);
      const swipes = await need(data.swipes());
      const found = swipes.swipes
        .filter(
          (s) =>
            onPlatform(s, a.platform) &&
            (s.outlier ?? 0) >= a.min_outlier &&
            within(s.publishedAt, a.since_days, now) &&
            (!a.analyzed_only || s.analysis) &&
            (!a.pillar || eq(s.analysis?.pillar, a.pillar)) &&
            (!a.hook_pattern || has(s.analysis?.hookPattern, a.hook_pattern)) &&
            (!a.format || has(s.analysis?.format, a.format)) &&
            (!a.search || has(s.text, a.search) || has(s.analysis?.hook, a.search)) &&
            matchesMedia(s, a.media),
        )
        .sort((x, y) => (a.sort === "outlier" ? (y.outlier ?? 0) - (x.outlier ?? 0) : 0) || Date.parse(y.publishedAt) - Date.parse(x.publishedAt));
      return { total: found.length, returned: Math.min(found.length, a.limit), swipes: found.slice(0, a.limit).map((s) => swipeOut(s, false)) };
    },
  },
  {
    name: "get_swipe",
    title: "One swipe in full",
    description: "One swipe-file post in full: every thread post, quoted post, media and the complete breakdown.",
    schema: getSwipeArgs,
    run: async (raw, data) => {
      const a = getSwipeArgs.parse(raw);
      const swipes = await need(data.swipes());
      const norm = (u: string) => u.replace(/[?#].*$/, "").replace(/\/$/, "").replace("twitter.com", "x.com").toLowerCase();
      const s = swipes.swipes.find((x) => (a.id && x.id === a.id) || (a.url && norm(x.url) === norm(a.url)));
      if (!s) throw new ToolError(`No swipe with ${a.id ? `id ${a.id}` : `url ${a.url}`}`);
      return swipeOut(s, true);
    },
  },
  {
    name: "hook_patterns",
    title: "Which hooks and formats over-perform",
    description:
      "The swipe file grouped by hook pattern, format or pillar: how many posts, median and best outlier score, and the top examples (hook line + link). Start here to pick a hook or format.",
    schema: hookPatternsArgs,
    run: async (raw, data, now) => {
      const a = hookPatternsArgs.parse(raw);
      const swipes = await need(data.swipes());
      const field = { hook_pattern: "hookPattern", format: "format", pillar: "pillar" } as const;
      const groups = new Map<string, Swipe[]>();
      for (const s of swipes.swipes) {
        if (!s.analysis || !onPlatform(s, a.platform) || !within(s.publishedAt, a.since_days, now)) continue;
        const key = s.analysis[field[a.group_by]]?.trim();
        if (!key) continue;
        const k = groups.has(key) ? key : ([...groups.keys()].find((g) => eq(g, key)) ?? key);
        groups.set(k, [...(groups.get(k) ?? []), s]);
      }
      const rows = [...groups].map(([name, list]) => {
        const scores = list.map((s) => s.outlier).filter((x): x is number => x != null);
        const top = [...list].sort((x, y) => (y.outlier ?? 0) - (x.outlier ?? 0)).slice(0, a.examples);
        return {
          [a.group_by]: name,
          posts: list.length,
          median_outlier: median(scores),
          best_outlier: scores.length ? Math.max(...scores) : null,
          examples: top.map((s) => ({ id: s.id, hook: s.analysis!.hook, format: s.analysis!.format, outlier: s.outlier, author: `@${s.author.handle}`, url: s.url })),
        };
      });
      rows.sort((x, y) => (y.median_outlier ?? 0) - (x.median_outlier ?? 0) || y.posts - x.posts);
      return { grouped_by: a.group_by, analyzed_posts: rows.reduce((n, r) => n + r.posts, 0), groups: rows };
    },
  },
  {
    name: "my_outliers",
    title: "Daksh's own best posts",
    description:
      "Daksh's own published posts that beat his typical post (outlier = views ÷ his median), with text and metrics. Shows what already works with his audience.",
    schema: myOutliersArgs,
    run: async (raw, data, now) => {
      const a = myOutliersArgs.parse(raw);
      const platforms = a.platform === "both" ? [...PLATFORMS] : [a.platform];
      const results = await Promise.all(platforms.map((p) => data.analytics(p)));
      const unavailable: string[] = [];
      const posts: Post[] = [];
      results.forEach((r) => (r.status === "ok" ? posts.push(...r.data.posts) : unavailable.push(describeMissing(r))));
      if (!posts.length && unavailable.length) throw new ToolError(unavailable.join("; "));
      const found = posts
        .filter((p) => (p.outlier ?? 0) >= a.min_outlier && within(p.publishedAt, a.since_days, now))
        .sort((x, y) => (y.outlier ?? 0) - (x.outlier ?? 0));
      return {
        total: found.length,
        posts: found.slice(0, a.limit).map((p) => ({ ...postOut(p), thread: p.thread })),
        ...(unavailable.length ? { unavailable } : {}),
      };
    },
  },
];

// ---------- Output shapes ----------

function postOut(p: Post) {
  return {
    id: p.id,
    platform: p.platform,
    url: p.url,
    author: p.author.handle ? `${p.author.name} (@${p.author.handle})` : p.author.name,
    published_at: p.publishedAt,
    outlier: p.outlier,
    metrics: p.metrics,
    text: p.text,
  };
}

function swipeOut(s: Swipe, full: boolean) {
  const a = s.analysis;
  return {
    ...postOut(s),
    thread: full ? s.thread : s.thread.slice(0, 3),
    ...(full || s.thread.length <= 3 ? {} : { thread_more: s.thread.length - 3 }),
    quoted: s.quoted ? { author: `@${s.quoted.author.handle}`, text: s.quoted.text, url: s.quoted.url } : null,
    media: full ? s.media : s.media.map((m) => m.kind),
    saved_at: s.savedAt,
    analysis: a
      ? {
          hook: a.hook,
          hook_pattern: a.hookPattern,
          format: a.format,
          pillar: a.pillar,
          why_it_works: a.whyItWorks,
          skeleton: a.skeleton,
          borrow: a.borrow,
          design: a.design,
          confidence: a.confidence,
        }
      : null,
  };
}

// ---------- Helpers ----------

class ToolError extends Error {}

async function need<T>(r: Promise<SourceResult<T>>): Promise<T> {
  const res = await r;
  if (res.status === "ok") return res.data;
  throw new ToolError(describeMissing(res));
}

function describeMissing(r: Exclude<SourceResult<unknown>, { status: "ok" }>): string {
  return r.status === "not_connected"
    ? `${r.source} is not connected${r.missing.length ? ` (needs ${r.missing.join(", ")})` : ""}`
    : `${r.source} failed: ${r.message}`;
}

const onPlatform = (p: Post, platform: Platform | "both") => platform === "both" || p.platform === platform;
const eq = (a: string | null | undefined, b: string) => a?.trim().toLowerCase() === b.trim().toLowerCase();
const has = (a: string | null | undefined, b: string) => Boolean(a?.toLowerCase().includes(b.trim().toLowerCase()));
const within = (iso: string, days: number | undefined, now: Date) => !days || Date.parse(iso) >= now.getTime() - days * 86_400_000;

// ---------- JSON-RPC ----------

type Id = string | number | null;
interface RpcRequest {
  jsonrpc?: string;
  id?: Id;
  method?: string;
  params?: Record<string, unknown>;
}

const ok = (id: Id, result: unknown) => ({ jsonrpc: "2.0" as const, id, result });
const fail = (id: Id, code: number, message: string) => ({ jsonrpc: "2.0" as const, id, error: { code, message } });

export const toolList = () =>
  TOOLS.map((t) => {
    const inputSchema = z.toJSONSchema(t.schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
    delete inputSchema.$schema;
    return { name: t.name, title: t.title, description: t.description, inputSchema, annotations: { readOnlyHint: true, openWorldHint: false } };
  });

/** One JSON-RPC message in; the response, or null for a notification. */
export async function handleRpc(msg: RpcRequest, data: McpData, now = new Date()): Promise<object | null> {
  const id = msg.id ?? null;
  const isNotification = msg.id === undefined;
  if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return isNotification ? null : fail(id, -32600, "Invalid request");
  if (isNotification) return null;

  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion ?? "");
      return ok(id, {
        protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "content-os", title: "Content OS", version: "1.0.0" },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: toolList() });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === msg.params?.name);
      if (!tool) return fail(id, -32602, `Unknown tool: ${String(msg.params?.name)}`);
      try {
        const result = await tool.run(msg.params?.arguments ?? {}, data, now);
        return ok(id, { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result });
      } catch (e) {
        const message =
          e instanceof z.ZodError ? `Invalid arguments: ${z.prettifyError(e)}` : e instanceof ToolError ? e.message : `Failed: ${e instanceof Error ? e.message : String(e)}`;
        return ok(id, { content: [{ type: "text", text: message }], isError: true });
      }
    }
    case "resources/list":
      return ok(id, { resources: [] });
    case "prompts/list":
      return ok(id, { prompts: [] });
    default:
      return fail(id, -32601, `Method not found: ${msg.method}`);
  }
}

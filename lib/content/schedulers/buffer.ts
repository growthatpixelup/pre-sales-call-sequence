import { NotConnected, cached } from "../errors";
import type { Platform, PostStatus, ScheduledPost } from "../types";
import { inWindow } from "./typefully";

/**
 * Buffer (GraphQL API), read-only: posts on the organisation's LinkedIn and X channels, for the
 * content calendar. Uses the same BUFFER_API_KEY and BUFFER_ORG_ID as the "post is live" alerts.
 * CONTENT_BUFFER_CHANNEL_IDS (comma-separated) limits it to some channels, e.g. Daksh's only.
 */

const BUFFER_API_URL = "https://api.buffer.com";
const PAGE = 50;
const MAX_PAGES = 6;
/** Posts created longer ago than this are past the calendar's window. */
const LOOKBACK_DAYS = 60;

export interface BufferChannel {
  id: string;
  name: string | null;
  displayName: string | null;
  service: string | null;
}

export interface BufferPostNode {
  id: string;
  text: string | null;
  status: string | null;
  dueAt: string | null;
  sentAt: string | null;
  createdAt: string | null;
  externalLink: string | null;
  channelId: string;
  error: { message: string | null } | null;
}

export function platformOf(service: string | null): Platform | null {
  const s = (service ?? "").toLowerCase();
  if (s.includes("linkedin")) return "linkedin";
  if (s === "twitter" || s === "x" || s.includes("twitter")) return "x";
  return null;
}

const STATUS: Record<string, PostStatus> = {
  sent: "published",
  scheduled: "scheduled",
  sending: "scheduled",
  draft: "draft",
  needs_approval: "draft",
  error: "failed",
};

export function fromBufferPost(p: BufferPostNode, platform: Platform): ScheduledPost | null {
  const status = STATUS[(p.status ?? "").toLowerCase()];
  if (!status) return null;
  return {
    id: `buffer-${p.id}`,
    scheduler: "buffer",
    platform,
    status,
    at: status === "draft" ? null : status === "published" ? (p.sentAt ?? p.dueAt) : p.dueAt,
    text: p.text?.trim() || "(no text)",
    url: p.externalLink,
    error: status === "failed" ? (p.error?.message ?? "Buffer couldn't publish this post.") : null,
  };
}

type GraphQLResponse<T> = { data?: T; errors?: { message?: string; extensions?: { code?: string } }[] };

async function gql<T>(key: string, query: string): Promise<T> {
  const res = await fetch(BUFFER_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query }),
    cache: "no-store",
  });
  if (res.status === 429) throw new Error("Buffer is rate limiting us; try again in a minute.");
  if (res.status === 401) throw new Error("Buffer rejected the API key (BUFFER_API_KEY).");
  let json: GraphQLResponse<T>;
  try {
    json = await res.json();
  } catch {
    throw new Error(`Buffer returned ${res.status}.`);
  }
  // Buffer answers 200 even when the query fails.
  if (json.errors?.length) {
    if (json.errors.some((e) => e.extensions?.code === "RATE_LIMIT_EXCEEDED")) {
      throw new Error("Buffer is rate limiting us; try again in a minute.");
    }
    throw new Error(`Buffer: ${json.errors.map((e) => e.message ?? "unknown error").join("; ")}`);
  }
  if (!res.ok || !json.data) throw new Error(`Buffer returned ${res.status}.`);
  return json.data;
}

/** The API key, the org, and Daksh's LinkedIn/X channels (CONTENT_BUFFER_CHANNEL_IDS, else all of them). */
const connect = cached(30 * 60_000, async () => {
  const key = process.env.BUFFER_API_KEY;
  const orgId = process.env.BUFFER_ORG_ID;
  const missing = [!key && "BUFFER_API_KEY", !orgId && "BUFFER_ORG_ID"].filter((m): m is string => Boolean(m));
  if (missing.length) throw new NotConnected(missing);
  const org = JSON.stringify(orgId);
  const { channels } = await gql<{ channels: BufferChannel[] }>(
    key!,
    `query { channels(input: { organizationId: ${org} }) { id name displayName service } }`,
  );
  const only = (process.env.CONTENT_BUFFER_CHANNEL_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const platformById = new Map<string, Platform>();
  for (const c of channels) {
    const platform = platformOf(c.service);
    if (platform && (!only.length || only.includes(c.id))) platformById.set(c.id, platform);
  }
  return { key: key!, org, platformById };
});

const read = cached(3 * 60_000, async () => {
  const { key, org, platformById } = await connect();
  if (!platformById.size) return [];

  const ids = [...platformById.keys()].map((id) => JSON.stringify(id)).join(", ");
  const since = Date.now() - LOOKBACK_DAYS * 86_400_000;
  const out: ScheduledPost[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data: {
      posts: { edges: { node: BufferPostNode }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
    } = await gql(
      key,
      `query ContentCalendar {
  posts(first: ${PAGE}${after ? `, after: ${JSON.stringify(after)}` : ""}, input: {
    organizationId: ${org}
    filter: { channelIds: [${ids}] }
    sort: [{ field: createdAt, direction: desc }]
  }) {
    edges { node { id text status dueAt sentAt createdAt externalLink channelId error { message } } }
    pageInfo { hasNextPage endCursor }
  }
}`,
    );
    const nodes = data.posts.edges.map((e) => e.node);
    for (const node of nodes) {
      const post = fromBufferPost(node, platformById.get(node.channelId)!);
      if (post) out.push(post);
    }
    const oldest = nodes[nodes.length - 1]?.createdAt;
    if (!data.posts.pageInfo.hasNextPage || !data.posts.pageInfo.endCursor || (oldest && Date.parse(oldest) < since)) break;
    after = data.posts.pageInfo.endCursor;
  }
  return out;
});

/** Buffer posts from 3 weeks back to 3 weeks ahead, plus drafts. */
export async function readBuffer(now: Date): Promise<ScheduledPost[]> {
  return inWindow(await read(), now);
}

// ---------- Analytics: published posts with Buffer's per-post metrics ----------

export interface BufferMetric {
  type: string;
  value: number;
}

export interface SentPost {
  id: string;
  platform: Platform;
  text: string;
  sentAt: string;
  url: string | null;
  metrics: Record<string, number>;
}

const SENT_PAGES = 12;

/**
 * Every post Buffer published on Daksh's channels, newest first, with lifetime metrics
 * (impressions, reactions, comments, reposts, clicks). Refreshed every 10 minutes.
 */
export const readBufferSent = cached(10 * 60_000, async (): Promise<SentPost[]> => {
  const { key, org, platformById } = await connect();
  if (!platformById.size) return [];
  const ids = [...platformById.keys()].map((id) => JSON.stringify(id)).join(", ");
  const out: SentPost[] = [];
  let after: string | null = null;
  for (let page = 0; page < SENT_PAGES; page++) {
    const data: {
      posts: {
        edges: { node: { id: string; text: string | null; sentAt: string | null; externalLink: string | null; channelId: string; metrics: BufferMetric[] | null } }[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    } = await gql(
      key,
      `query ContentAnalytics {
  posts(first: ${PAGE}${after ? `, after: ${JSON.stringify(after)}` : ""}, input: {
    organizationId: ${org}
    filter: { channelIds: [${ids}], status: [sent] }
    sort: [{ field: createdAt, direction: desc }]
  }) {
    edges { node { id text sentAt externalLink channelId metrics { type value } } }
    pageInfo { hasNextPage endCursor }
  }
}`,
    );
    for (const { node } of data.posts.edges) {
      const platform = platformById.get(node.channelId);
      if (!platform || !node.sentAt) continue;
      out.push({
        id: node.id,
        platform,
        text: node.text?.trim() ?? "",
        sentAt: node.sentAt,
        url: node.externalLink,
        metrics: Object.fromEntries((node.metrics ?? []).map((m) => [m.type, m.value])),
      });
    }
    if (!data.posts.pageInfo.hasNextPage || !data.posts.pageInfo.endCursor) break;
    after = data.posts.pageInfo.endCursor;
  }
  return out;
});

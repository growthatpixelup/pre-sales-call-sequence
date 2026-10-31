import "server-only";

import type { AlertDeps, AlertRow } from "./alert";
import { sendAlert } from "./alert";

export const BUFFER_API_URL = "https://api.buffer.com";
const POSTS_PER_RUN = 20;

export type BufferPost = {
  id: string;
  text: string | null;
  sentAt: string | null;
  externalLink: string | null;
  channelId: string;
};

type BufferChannel = { id: string; name: string | null; displayName: string | null; service: string | null };

type GraphQLError = { message?: string; extensions?: { code?: string; window?: string } };

/**
 * One request per run: the latest sent posts for the LinkedIn channels, plus channel names for
 * the Slack label. IDs come from env and are inlined as JSON strings (valid GraphQL strings).
 */
export function sentPostsQuery(orgId: string, channelIds: string[]) {
  const org = JSON.stringify(orgId);
  const channels = channelIds.map((id) => JSON.stringify(id)).join(", ");
  return `query SentLinkedInPosts {
  posts(first: ${POSTS_PER_RUN}, input: {
    organizationId: ${org}
    filter: { status: [sent], channelIds: [${channels}] }
    sort: [{ field: createdAt, direction: desc }]
  }) {
    edges { node { id text sentAt externalLink channelId } }
  }
  channels(input: { organizationId: ${org} }) { id name displayName service }
}`;
}

export type PollConfig = {
  apiKey: string | undefined;
  orgId: string | undefined;
  /** Comma-separated, as in BUFFER_LINKEDIN_CHANNEL_IDS. */
  channelIds: string | undefined;
};

export type PollResult = { status: number; body: Record<string, unknown> };

/** Polls Buffer for newly sent LinkedIn posts and alerts each one once. */
export async function pollBufferSent(
  config: PollConfig,
  deps: AlertDeps & { fetch?: typeof fetch },
): Promise<PollResult> {
  const channelIds = (config.channelIds ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const missing = [
    !config.apiKey && "BUFFER_API_KEY",
    !config.orgId && "BUFFER_ORG_ID",
    !channelIds.length && "BUFFER_LINKEDIN_CHANNEL_IDS",
  ].filter(Boolean);
  if (missing.length) return { status: 500, body: { error: `Not configured: ${missing.join(", ")}` } };

  const fetchImpl = deps.fetch ?? fetch;
  const res = await fetchImpl(BUFFER_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ query: sentPostsQuery(config.orgId!, channelIds) }),
    cache: "no-store",
  });

  // Rate limited: log and stop. The next scheduled run tries again.
  if (res.status === 429) {
    const retryAfter = res.headers.get("retry-after");
    console.warn(`[buffer poll] rate limited by Buffer; retryAfter=${retryAfter ?? "unknown"}s`);
    return { status: 200, body: { skipped: "rate_limited", retryAfter } };
  }

  let json: { data?: { posts?: { edges?: { node: BufferPost }[] }; channels?: BufferChannel[] }; errors?: GraphQLError[] };
  try {
    json = await res.json();
  } catch {
    console.error(`[buffer poll] Buffer returned ${res.status} with a non-JSON body`);
    return { status: 502, body: { error: `Buffer returned ${res.status}` } };
  }

  // Buffer returns 200 even when the query fails, so check `errors` too.
  if (json.errors?.length) {
    if (json.errors.some((e) => e.extensions?.code === "RATE_LIMIT_EXCEEDED")) {
      const retryAfter = res.headers.get("retry-after");
      console.warn(`[buffer poll] rate limited by Buffer; retryAfter=${retryAfter ?? "unknown"}s`);
      return { status: 200, body: { skipped: "rate_limited", retryAfter } };
    }
    const messages = json.errors.map((e) => e.message ?? "unknown error");
    console.error("[buffer poll] Buffer GraphQL errors:", messages);
    return { status: 502, body: { error: "Buffer GraphQL error", messages } };
  }
  if (!res.ok) return { status: 502, body: { error: `Buffer returned ${res.status}` } };

  const posts = (json.data?.posts?.edges ?? []).map((e) => e.node);
  const channelNames = new Map(
    (json.data?.channels ?? []).map((c) => [c.id, c.displayName || c.name || null] as const),
  );

  // Only posts with a live link. A null externalLink is picked up by a later run.
  const live = posts.filter((p) => p.externalLink);
  const rowFor = (p: BufferPost): AlertRow => ({
    source: "buffer",
    platform: "linkedin",
    external_id: p.id,
    url: p.externalLink!,
  });

  // First run: record what's already sent without posting, so old posts don't flood the channel.
  if (!(await deps.store.hasAny("buffer"))) {
    await deps.store.markSeen(live.map(rowFor));
    return { status: 200, body: { firstRun: true, seeded: live.length, pendingLink: posts.length - live.length } };
  }

  // Oldest first, so the channel reads in publish order.
  const results: Record<string, string> = {};
  let failed = false;
  for (const post of [...live].reverse()) {
    try {
      results[post.id] = await sendAlert(
        { ...rowFor(post), accountLabel: channelNames.get(post.channelId) ?? null, text: post.text },
        deps,
      );
    } catch (err) {
      failed = true;
      results[post.id] = "failed";
      console.error(`[buffer poll] alert for post ${post.id} failed:`, err);
    }
  }

  return {
    status: failed ? 500 : 200,
    body: { checked: posts.length, pendingLink: posts.length - live.length, results },
  };
}

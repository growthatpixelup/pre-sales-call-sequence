/**
 * Public numbers for any X post, from the endpoint X's embedded-tweet widget uses (the same one
 * Vercel's react-tweet reads): current likes and replies, full text, photos and video. No views,
 * reposts or bookmarks. No key needed; read-only.
 */

import type { Media } from "./types";

export interface XEmbed {
  id: string;
  likes: number | null;
  replies: number | null;
  text: string | null;
  media: Media[];
  createdAt: string | null;
}

/** The token the embed endpoint expects, derived from the post id (as react-tweet does). */
export function embedToken(id: string): string {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
}

type Raw = {
  favorite_count?: number;
  conversation_count?: number;
  text?: string;
  created_at?: string;
  display_text_range?: [number, number];
  photos?: { url?: string; accessibilityLabel?: string }[];
  video?: { poster?: string; variants?: { type?: string; src?: string }[] };
  mediaDetails?: { type?: string; media_url_https?: string; ext_alt_text?: string }[];
};

export function fromEmbed(id: string, d: Raw): XEmbed {
  const range = d.display_text_range;
  const text = d.text ? (range ? [...d.text].slice(range[0], range[1]).join("") : d.text).replace(/\s*https:\/\/t\.co\/\w+$/, "").trim() : null;
  const media: Media[] = [];
  for (const p of d.photos ?? []) if (p.url) media.push({ kind: "image", url: p.url, alt: p.accessibilityLabel ?? "" });
  if (d.video) {
    const mp4 = d.video.variants?.find((v) => v.type === "video/mp4")?.src ?? null;
    media.push({ kind: "video", url: mp4, poster: d.video.poster ?? null, alt: "Video" });
  }
  return {
    id,
    likes: typeof d.favorite_count === "number" ? d.favorite_count : null,
    replies: typeof d.conversation_count === "number" ? d.conversation_count : null,
    text: text || null,
    media,
    createdAt: d.created_at ?? null,
  };
}

const TTL = 30 * 60_000;
const cache = new Map<string, { at: number; value: XEmbed | null }>();

async function fetchOne(id: string): Promise<XEmbed | null> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  let value: XEmbed | null = null;
  try {
    const res = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=${embedToken(id)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) value = fromEmbed(id, (await res.json()) as Raw);
  } catch {
    // Deleted, protected, or the endpoint is down: the post keeps whatever other sources gave.
  }
  cache.set(id, { at: Date.now(), value });
  return value;
}

/** Embeds for many posts, six at a time. Missing ones are left out. */
export async function readXEmbeds(ids: string[]): Promise<Map<string, XEmbed>> {
  const out = new Map<string, XEmbed>();
  const queue = [...new Set(ids)];
  await Promise.all(
    Array.from({ length: Math.min(6, queue.length) }, async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        const e = await fetchOne(id);
        if (e) out.set(id, e);
      }
    }),
  );
  return out;
}

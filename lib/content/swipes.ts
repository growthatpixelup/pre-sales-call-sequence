/** Swipe file filters and header numbers. Pure. */

import type { MediaFilter, Platform, Swipe, SwipeRun } from "./types";

export const SWIPE_ORDERS = [
  { value: "newest", label: "Newest" },
  { value: "outlier", label: "Biggest outlier" },
] as const;
export type SwipeOrder = (typeof SWIPE_ORDERS)[number]["value"];

export interface SwipeFilters {
  platform: Platform | "both";
  /** A pillar name, or "all". */
  pillar: string;
  media: MediaFilter;
  order: SwipeOrder;
}

export function matchesMedia(swipe: Swipe, media: MediaFilter): boolean {
  switch (media) {
    case "any":
      return true;
    case "images":
      return swipe.media.some((m) => m.kind === "image");
    case "video":
      return swipe.media.some((m) => m.kind === "video");
    case "text":
      return swipe.media.length === 0 && !swipe.quoted;
    case "design":
      return swipe.analysis?.design === true;
  }
}

export function filterSwipes(swipes: Swipe[], f: SwipeFilters): Swipe[] {
  const pillar = f.pillar.toLowerCase();
  return swipes
    .filter(
      (s) =>
        (f.platform === "both" || s.platform === f.platform) &&
        (f.pillar === "all" || s.analysis?.pillar?.toLowerCase() === pillar) &&
        matchesMedia(s, f.media),
    )
    .sort((a, b) =>
      f.order === "outlier"
        ? (b.outlier ?? 0) - (a.outlier ?? 0) || Date.parse(b.savedAt) - Date.parse(a.savedAt)
        : Date.parse(b.savedAt) - Date.parse(a.savedAt) || Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
    );
}

/** "214 swipes from 87 accounts", plus the last finished sync. */
export function swipeStats(swipes: Swipe[], runs: SwipeRun[]) {
  const accounts = new Set(swipes.map((s) => `${s.platform}:${s.author.handle.toLowerCase()}`));
  const lastSync = runs
    .filter((r) => (r.status === "ok" || r.status === "partial") && r.finishedAt)
    .sort((a, b) => Date.parse(b.finishedAt!) - Date.parse(a.finishedAt!))[0];
  const lastRun = [...runs].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0] ?? null;
  return { count: swipes.length, accounts: accounts.size, lastSync: lastSync ?? null, lastRun };
}

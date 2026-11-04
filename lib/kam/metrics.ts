import type { KamActivity } from "./types";

/** Touches logged on a stakeholder before they first replied, or null if they haven't. */
export function touchesBeforeReply(activity: KamActivity[]): number | null {
  const sorted = [...activity].sort((a, b) => (a.day === b.day ? a.id - b.id : a.day < b.day ? -1 : 1));
  const firstReply = sorted.findIndex((a) => a.type === "reply");
  if (firstReply === -1) return null;
  return sorted.slice(0, firstReply).reduce((n, a) => n + a.count, 0);
}

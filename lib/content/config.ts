/**
 * Content OS settings: who the creator is, the posting cadence the calendar checks against, the
 * swipe file's content pillars, and links to the outside tools. Edit here; nothing else needs to change.
 */

import type { Platform } from "./types";

/** The creator whose accounts the dashboard reports on. */
export const CREATOR = {
  name: "Daksh Aswal",
  x: { handle: "dakshpixelup", url: "https://x.com/dakshpixelup" },
  linkedin: { handle: "dakshpixelup", url: "https://www.linkedin.com/in/dakshpixelup" },
} as const;

/** Daksh's Typefully account (social set), which posts to his X and LinkedIn. */
export const TYPEFULLY_SOCIAL_SET_ID = 338929;

export interface Cadence {
  /** Post on every Nth day (1 = daily, 2 = every other day). */
  everyNDays: number;
  /** Slot times on a posting day, "HH:MM" in the dashboard time zone. */
  slots: string[];
  /** Slots per weekday (Monday first), when they differ by day; overrides everyNDays/slots. */
  byWeekday?: string[][];
}

/**
 * Posting goals the calendar checks against: X twice a day, LinkedIn on Monday, Wednesday and
 * Friday. Slot times are when Daksh usually posts (India time); a post at another time still
 * counts toward the day.
 */
const X_SLOTS = ["17:00", "21:00"];
const LINKEDIN_SLOT = ["21:00"];
export const CADENCE: Record<Platform, Cadence> = {
  x: { everyNDays: 1, slots: X_SLOTS },
  //                Mon            Tue Wed            Thu Fri            Sat Sun
  linkedin: { everyNDays: 1, slots: [], byWeekday: [LINKEDIN_SLOT, [], LINKEDIN_SLOT, [], LINKEDIN_SLOT, [], []] },
};

/** Content pillars the swipe file is tagged with (the bot writes one of these per swipe). */
export const PILLARS = ["B2B & AI", "B2C", "Growth & brand", "Commentary"] as const;

export const TOOLS = {
  xAnalytics: { label: "X analytics", href: "https://x.com/i/account_analytics" },
  linkedinAnalytics: { label: "LinkedIn analytics", href: "https://www.linkedin.com/analytics/creator/content/" },
  typefully: { label: "Typefully", href: "https://typefully.com" },
  buffer: { label: "Buffer", href: "https://publish.buffer.com" },
  xBookmarks: { label: "X bookmarks", href: "https://x.com/i/bookmarks" },
  linkedinSaved: { label: "LinkedIn saved", href: "https://www.linkedin.com/my-items/saved-posts/" },
} as const;

/** Where an "open slot" sends you to fill it. */
export const SCHEDULER_FOR: Record<Platform, keyof typeof TOOLS> = { x: "typefully", linkedin: "buffer" };

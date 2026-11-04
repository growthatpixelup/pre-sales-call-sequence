/** KAM: accounts, stakeholders and the team's daily touches (supabase/migrations/011_kam.sql). */

export const KAM_STAGES = ["identified", "engaging", "dm_sent", "replied", "conversation", "call_booked"] as const;
export type KamStage = (typeof KAM_STAGES)[number];

export const KAM_STAGE_LABELS: Record<KamStage, string> = {
  identified: "Identified",
  engaging: "Engaging",
  dm_sent: "DM sent",
  replied: "Replied",
  conversation: "Conversation",
  call_booked: "Call booked",
};

export const ACTIVITY_TYPES = ["like", "comment", "follow", "connect", "dm", "reply", "feedback", "intro", "other"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  like: "Like",
  comment: "Comment",
  follow: "Follow",
  connect: "Connect request",
  dm: "DM",
  reply: "They replied",
  feedback: "Product feedback",
  intro: "Intro",
  other: "Other",
};

export const PLATFORMS = ["linkedin", "x", "email", "other"] as const;
export type Platform = (typeof PLATFORMS)[number];
export const PLATFORM_LABELS: Record<Platform, string> = { linkedin: "LinkedIn", x: "X", email: "Email", other: "Other" };

export const ACCOUNT_STATUSES = ["active", "paused", "won", "dropped"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** Daily targets per member (spec.md and the Notion member pages). */
export const DAILY_TARGETS = { engagement: { min: 15, max: 20 }, dms: { min: 2, max: 3 } };
/** A stakeholder with no touch for this long is going cold. */
export const COLD_DAYS = 7;

/**
 * The stage a touch moves a stakeholder to, if it's further than where they are. Conversation and
 * Call booked are set by hand.
 */
export const STAGE_FROM_ACTIVITY: Partial<Record<ActivityType, KamStage>> = {
  like: "engaging",
  comment: "engaging",
  follow: "engaging",
  connect: "engaging",
  feedback: "engaging",
  intro: "engaging",
  dm: "dm_sent",
  reply: "replied",
};

export const kamStageRank = (stage: KamStage) => KAM_STAGES.indexOf(stage);

export interface KamMember {
  id: string;
  name: string;
  slackUserId: string | null;
  email: string | null;
  active: boolean;
}

export interface KamAccount {
  id: string;
  company: string;
  domain: string | null;
  website: string | null;
  ownerId: string | null;
  status: AccountStatus;
  notes: string;
  createdAt: string;
}

export interface KamStakeholder {
  id: string;
  accountId: string;
  name: string;
  role: string | null;
  linkedinUrl: string | null;
  xUrl: string | null;
  stage: KamStage;
  ownerId: string | null;
  leadId: string | null;
  notes: string;
  lastTouchAt: string | null;
  createdAt: string;
}

export interface KamActivity {
  id: number;
  /** "YYYY-MM-DD". */
  day: string;
  memberId: string | null;
  accountId: string | null;
  stakeholderId: string | null;
  type: ActivityType;
  platform: Platform;
  count: number;
  link: string | null;
  note: string | null;
  personName: string | null;
  companyName: string | null;
  reviewed: boolean;
  source: "manual" | "slack";
  slackMessageId: string | null;
  createdAt: string;
}

/** A touch that names a person no stakeholder matches, and nobody has dealt with yet. */
export const needsReview = (a: Pick<KamActivity, "stakeholderId" | "personName" | "reviewed">) =>
  !a.stakeholderId && Boolean(a.personName) && !a.reviewed;

export const isEngagement = (type: ActivityType) => type === "like" || type === "comment";

import type { EmailStatus } from "@/lib/emails/queue";
import type { CallStatus } from "@/lib/format";
import type { LeadStage } from "@/lib/leads/types";
import { Tag, type Tone } from "./ui";

// One accent: blue marks what needs attention or is live, grey what's settled, dim what's off.
const CALL_STATUS_STYLES: Record<CallStatus, { label: string; tone: Tone }> = {
  upcoming: { label: "Upcoming", tone: "accent" },
  past: { label: "Completed", tone: "neutral" },
  pending: { label: "Awaiting confirmation", tone: "accent" },
  cancelled: { label: "Cancelled", tone: "muted" },
  rejected: { label: "Rejected", tone: "muted" },
};

export const STAGE_LABELS: Record<LeadStage, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  proposal: "Proposal sent",
  payment: "Payment processing",
  won: "Won",
  lost: "Lost",
  closed: "Closed",
};

const STAGE_TONES: Record<LeadStage, Tone> = {
  new: "accent",
  contacted: "accent",
  qualified: "accent",
  proposal: "accent",
  payment: "accent",
  won: "neutral",
  lost: "muted",
  closed: "muted",
};

const EMAIL_STATUS_STYLES: Record<EmailStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft: needs sending", tone: "accent" },
  scheduled: { label: "Scheduled", tone: "accent" },
  sending: { label: "Sending", tone: "accent" },
  sent: { label: "Sent", tone: "neutral" },
  skipped: { label: "Skipped", tone: "muted" },
  cancelled: { label: "Cancelled", tone: "muted" },
  failed: { label: "Failed", tone: "neutral" },
};

export function EmailStatusBadge({ status }: { status: EmailStatus | null }) {
  if (!status) return <Tag tone="muted">Not scheduled</Tag>;
  const s = EMAIL_STATUS_STYLES[status];
  return <Tag tone={s.tone}>{s.label}</Tag>;
}

export function CallStatusBadge({ status }: { status: CallStatus }) {
  const s = CALL_STATUS_STYLES[status];
  return <Tag tone={s.tone}>{s.label}</Tag>;
}

export function StageBadge({ stage }: { stage: LeadStage }) {
  return <Tag tone={STAGE_TONES[stage]}>{STAGE_LABELS[stage]}</Tag>;
}

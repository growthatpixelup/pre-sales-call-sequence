export const LEAD_STAGES = ["new", "contacted", "qualified", "won", "lost"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export type BookingStatus = "accepted" | "pending" | "cancelled" | "rejected";

/** A single answer from the Cal.com booking form that isn't one of the mapped fields. */
export interface ExtraField {
  key: string;
  label: string;
  value: string;
}

export interface LegacyAnswers {
  phone: string | null;
  topic: string | null;
  notes: string | null;
  budget: string | null;
  twitter: string | null;
}

/** Per-lead email personalisation set on the dashboard. Unset values use lib/emails/config.ts. */
export interface EmailSettings {
  /** Case study id for Email 1. */
  caseStudyId?: string;
  /** Closing question for Email 1, as full text. */
  question?: string;
  /** "Who's joining" line for Email 3, e.g. "Daksh (Founder), Riya (Design lead)". */
  team?: string;
  /** Just the names, for the 1-hour reminder, e.g. "Daksh and Riya". */
  teamNames?: string;
}

export interface LeadEvent {
  type: string;
  at: string;
  detail?: string;
}

export interface Lead {
  /** Cal.com booking uid. */
  id: string;

  // Booking form answers
  name: string;
  email: string;
  businessName: string | null;
  businessWebsite: string | null;
  problem: string | null;
  bookingReason: string | null;
  capitalRaised: string | null;
  investmentRange: string | null;
  referralSource: string | null;
  extraFields: ExtraField[];

  /** Answers from the old booking form. Only set on leads that booked with it. */
  legacy: LegacyAnswers;

  // Booking details
  startTime: string;
  endTime: string;
  timeZone: string | null;
  eventTitle: string | null;
  eventSlug: string | null;
  eventTypeId: number | null;
  meetingUrl: string | null;
  bookingStatus: BookingStatus;
  cancellationReason: string | null;

  // Tracking (owned by the dashboard, never overwritten by Cal.com)
  stage: LeadStage;
  internalNotes: string;
  emailSettings: EmailSettings;
  events: LeadEvent[];

  source: "webhook" | "import";
  createdAt: string;
  updatedAt: string;
}

/** A raw form answer, normalised from either the webhook or the API. */
export interface RawField {
  key: string;
  label: string | null;
  value: unknown;
}

/** Booking data normalised from Cal.com, before it becomes a Lead. */
export interface BookingInput {
  id: string;
  startTime: string;
  endTime: string;
  timeZone: string | null;
  eventTitle: string | null;
  eventSlug: string | null;
  eventTypeId: number | null;
  meetingUrl: string | null;
  bookingStatus: BookingStatus;
  cancellationReason: string | null;
  attendeeName: string | null;
  attendeeEmail: string | null;
  attendeePhone: string | null;
  fields: RawField[];
}

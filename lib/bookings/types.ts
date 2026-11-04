import type { Stage } from "@/lib/leads/types";

/**
 * Cal.com bookings (table `bookings`). Each booking points at the GTM OS lead it belongs to
 * (lib/leads); the pipeline stage and prices live on the lead.
 */

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
  /** One line in Email 1 linking them to the case study. Left out when empty. */
  companyLine?: string;
  /** Closing question for Email 1, as full text. */
  question?: string;
  /** "Who's joining" line for Email 3, e.g. "Daksh (Founder), Riya (Design lead)". */
  team?: string;
}

export interface BookingEvent {
  type: string;
  at: string;
  detail?: string;
}

export interface Booking {
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

  /** When the call was booked in Cal.com. */
  bookedAt: string;

  /** The lead this booking belongs to. Null for our own and test bookings. */
  leadId: string | null;
  /** That lead's stage and value, loaded with the booking. */
  lead: BookingLead | null;

  // Owned by the dashboard, never overwritten by Cal.com
  emailSettings: EmailSettings;
  events: BookingEvent[];

  source: "webhook" | "import";
  createdAt: string;
  updatedAt: string;
}

/** The parts of a booking's lead that booking pages and analytics need. */
export interface BookingLead {
  id: string;
  stage: Stage;
  stageChangedAt: string | null;
  estimatedPrice: number | null;
  closedPrice: number | null;
}

/** A raw form answer, normalised from either the webhook or the API. */
export interface RawField {
  key: string;
  label: string | null;
  value: unknown;
}

/** Booking data normalised from Cal.com, before it becomes a Booking. */
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
  /** When the booking was made, if Cal.com says. */
  bookedAt: string | null;
  attendeeName: string | null;
  attendeeEmail: string | null;
  attendeePhone: string | null;
  fields: RawField[];
}

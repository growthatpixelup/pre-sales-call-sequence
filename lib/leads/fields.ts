import type { BookingInput, ExtraField, Lead, RawField } from "./types";

type MappedField =
  | "name"
  | "email"
  | "businessName"
  | "businessWebsite"
  | "problem"
  | "bookingReason"
  | "capitalRaised"
  | "investmentRange"
  | "referralSource";

/**
 * How booking form answers map onto lead fields. Cal.com sends each answer keyed by the
 * question's "identifier" (Event type → Advanced → Booking questions), and the webhook also
 * sends the question's label. A question matches a field if its identifier is in `keys`, or if
 * its label (or its identifier read as words) matches `label`. Fields are tried in this order
 * and each question fills at most one field. Unmatched answers are kept as extra fields.
 */
const FIELD_MAP: Record<MappedField, { keys: string[]; label: RegExp }> = {
  name: { keys: ["name", "fullName", "full-name"], label: /^(your )?(full )?name$/i },
  email: { keys: ["email"], label: /^(your )?email( address)?$/i },
  businessName: { keys: ["business-name", "businessName", "company"], label: /business name|company name/i },
  businessWebsite: { keys: ["business-website", "businessWebsite", "website"], label: /website/i },
  problem: { keys: ["problem"], label: /problem|looking to solve/i },
  bookingReason: { keys: ["why-did-you-book-this-call", "reason"], label: /why did you book/i },
  capitalRaised: { keys: ["capital-raised", "capitalRaised"], label: /capital|raised/i },
  investmentRange: {
    keys: ["investment-range", "investmentRange"],
    label: /investment range|expected investment/i,
  },
  referralSource: {
    keys: ["how-did-you-find-us", "referral", "source"],
    label: /find us|hear about us/i,
  },
};

/** Booking fields that are stored elsewhere on the lead or carry no lead information. */
const IGNORED_KEYS = new Set(["location", "rescheduleReason"]);

export function valueToString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(valueToString).filter((v): v is string => Boolean(v));
    return parts.length ? parts.join(", ") : null;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    // Split name field: { firstName, lastName }
    if ("firstName" in obj || "lastName" in obj) {
      return valueToString([obj.firstName, obj.lastName].filter(Boolean).join(" "));
    }
    // Location-style field: { value, optionValue }
    if ("optionValue" in obj && valueToString(obj.optionValue)) return valueToString(obj.optionValue);
    if ("value" in obj) return valueToString(obj.value);
    return JSON.stringify(obj);
  }
  return String(value);
}

function humanise(key: string) {
  return key
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^\w/, (c) => c.toUpperCase());
}

function matches(field: RawField, target: MappedField) {
  const rule = FIELD_MAP[target];
  const key = field.key.toLowerCase();
  if (rule.keys.some((k) => k.toLowerCase() === key)) return true;
  // The API import only has identifiers, so also try the identifier as words.
  return rule.label.test(field.label?.trim() || humanise(field.key));
}

/** Adds https:// to bare domains so they can be linked. */
export function normaliseUrl(value: string | null): string | null {
  if (!value) return null;
  const v = value.trim();
  if (/^https?:\/\//i.test(v)) return v;
  return /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v) ? `https://${v}` : v;
}

/** Turns a normalised booking into the Cal-owned part of a lead. */
export function bookingToLeadFields(
  booking: BookingInput,
): Omit<
  Lead,
  | "legacy"
  | "bookedAt"
  | "stage"
  | "stageChangedAt"
  | "dealValue"
  | "internalNotes"
  | "emailSettings"
  | "events"
  | "source"
  | "createdAt"
  | "updatedAt"
> {
  const mapped: Partial<Record<MappedField, string | null>> = {};
  const extraFields: ExtraField[] = [];

  for (const field of booking.fields) {
    if (IGNORED_KEYS.has(field.key)) continue;
    const value = valueToString(field.value);
    if (!value) continue;
    const target = (Object.keys(FIELD_MAP) as MappedField[]).find(
      (t) => mapped[t] == null && matches(field, t),
    );
    if (target) {
      mapped[target] = value;
    } else {
      extraFields.push({ key: field.key, label: field.label ?? humanise(field.key), value });
    }
  }

  return {
    id: booking.id,
    name: mapped.name ?? booking.attendeeName ?? "Unknown",
    email: mapped.email ?? booking.attendeeEmail ?? "",
    businessName: mapped.businessName ?? null,
    businessWebsite: normaliseUrl(mapped.businessWebsite ?? null),
    problem: mapped.problem ?? null,
    bookingReason: mapped.bookingReason ?? null,
    capitalRaised: mapped.capitalRaised ?? null,
    investmentRange: mapped.investmentRange ?? null,
    referralSource: mapped.referralSource ?? null,
    extraFields,
    startTime: booking.startTime,
    endTime: booking.endTime,
    timeZone: booking.timeZone,
    eventTitle: booking.eventTitle,
    eventSlug: booking.eventSlug,
    eventTypeId: booking.eventTypeId,
    meetingUrl: booking.meetingUrl,
    bookingStatus: booking.bookingStatus,
    cancellationReason: booking.cancellationReason,
  };
}

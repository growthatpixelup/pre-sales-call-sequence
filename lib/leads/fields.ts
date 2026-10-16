import type { BookingInput, ExtraField, Lead, RawField } from "./types";

type MappedField = "name" | "email" | "phone" | "topic" | "notes" | "budget" | "twitter";

/**
 * How booking form answers map onto lead fields. Cal.com sends each answer keyed by the
 * field's "identifier" (set in the event type's booking questions), and the webhook also
 * sends the label. A field matches if its identifier is in `keys` or its label matches.
 * If you rename a question in Cal.com, add its identifier here.
 */
const FIELD_MAP: Record<MappedField, { keys: string[]; label: RegExp }> = {
  name: { keys: ["name", "fullName", "full-name"], label: /^(your )?(full )?name$/i },
  email: { keys: ["email"], label: /^(your )?email( address)?$/i },
  phone: {
    keys: ["attendeePhoneNumber", "phone", "phoneNumber", "phone-number", "mobile", "mobileNumber", "mobile-number"],
    label: /mobile|phone|whatsapp/i,
  },
  topic: {
    keys: ["title", "what-is-this-meeting-about", "topic", "agenda"],
    label: /what is this meeting about|topic|agenda/i,
  },
  notes: { keys: ["notes", "additional-notes", "additionalNotes"], label: /additional notes/i },
  budget: { keys: ["budget", "your-budget"], label: /budget/i },
  twitter: {
    keys: ["twitter", "x", "x-twitter", "x-twitter-link", "twitter-link", "x-link", "xTwitterLink"],
    label: /twitter|^x\b|\bx link\b|x\/twitter/i,
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

function matches(field: RawField, target: MappedField) {
  const rule = FIELD_MAP[target];
  const key = field.key.toLowerCase();
  if (rule.keys.some((k) => k.toLowerCase() === key)) return true;
  return field.label ? rule.label.test(field.label.trim()) : false;
}

export function normaliseTwitter(value: string | null): string | null {
  if (!value) return null;
  const v = value.trim();
  if (/^https?:\/\//i.test(v)) return v;
  if (/^(www\.)?(x|twitter)\.com\//i.test(v)) return `https://${v}`;
  const handle = v.replace(/^@/, "");
  return /^\w{1,15}$/.test(handle) ? `https://x.com/${handle}` : v;
}

function humanise(key: string) {
  return key
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^\w/, (c) => c.toUpperCase());
}

/** Turns a normalised booking into the Cal-owned part of a lead. */
export function bookingToLeadFields(
  booking: BookingInput,
): Omit<Lead, "stage" | "internalNotes" | "events" | "source" | "createdAt" | "updatedAt"> {
  const mapped: Partial<Record<MappedField, string | null>> = {};
  const extraFields: ExtraField[] = [];

  for (const field of booking.fields) {
    if (IGNORED_KEYS.has(field.key)) continue;
    const target = (Object.keys(FIELD_MAP) as MappedField[]).find(
      (t) => mapped[t] == null && matches(field, t),
    );
    const value = valueToString(field.value);
    if (target) {
      mapped[target] = value;
    } else if (value) {
      extraFields.push({ key: field.key, label: field.label ?? humanise(field.key), value });
    }
  }

  return {
    id: booking.id,
    name: mapped.name ?? booking.attendeeName ?? "Unknown",
    email: mapped.email ?? booking.attendeeEmail ?? "",
    phone: mapped.phone ?? booking.attendeePhone ?? null,
    topic: mapped.topic ?? null,
    notes: mapped.notes ?? null,
    budget: mapped.budget ?? null,
    twitter: normaliseTwitter(mapped.twitter ?? null),
    extraFields,
    startTime: booking.startTime,
    endTime: booking.endTime,
    timeZone: booking.timeZone,
    eventTitle: booking.eventTitle,
    eventSlug: booking.eventSlug,
    meetingUrl: booking.meetingUrl,
    bookingStatus: booking.bookingStatus,
    cancellationReason: booking.cancellationReason,
  };
}

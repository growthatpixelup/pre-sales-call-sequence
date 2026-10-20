import type { Lead } from "@/lib/leads/types";

/** Time zone the dashboard shows times in. Falls back to the server's own time zone. */
const TIME_ZONE = process.env.DASHBOARD_TIMEZONE || undefined;

export function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: TIME_ZONE,
  }).format(new Date(iso));
}

export function formatDate(iso: string) {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: TIME_ZONE }).format(
    new Date(iso),
  );
}

export type CallStatus = "upcoming" | "past" | "pending" | "cancelled" | "rejected";

export function callStatus(lead: Lead, now = Date.now()): CallStatus {
  if (lead.bookingStatus === "cancelled" || lead.bookingStatus === "rejected") {
    return lead.bookingStatus;
  }
  if (lead.bookingStatus === "pending") return "pending";
  return new Date(lead.endTime).getTime() > now ? "upcoming" : "past";
}

const EVENT_LABELS: Record<string, string> = {
  linkedin_sent: "LinkedIn note sent",
  linkedin_skipped: "LinkedIn note skipped",
};

export function humaniseEvent(type: string) {
  return EVENT_LABELS[type] ?? type.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

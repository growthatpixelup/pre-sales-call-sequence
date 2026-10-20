import type { Lead } from "./types";

/** Our own and test addresses. Their bookings are kept in the database but left out of the dashboard. */
const INTERNAL_DOMAINS = ["pixeluplabs.com", "pixelup.in"];
const INTERNAL_EMAILS = ["goyalmonesh2201@gmail.com"];

export function isInternal(lead: Pick<Lead, "email">): boolean {
  const email = lead.email.trim().toLowerCase();
  return INTERNAL_EMAILS.includes(email) || INTERNAL_DOMAINS.some((d) => email.endsWith(`@${d}`));
}

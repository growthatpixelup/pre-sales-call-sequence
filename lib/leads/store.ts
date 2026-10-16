import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { bookingToLeadFields } from "./fields";
import type { BookingInput, BookingStatus, Lead, LeadEvent, LeadStage } from "./types";

/**
 * Lead storage. For now this is a JSON file at data/leads.json (local development only:
 * serverless hosts like Vercel have a read-only filesystem). To move to Supabase, re-implement
 * the exported functions below against a `leads` table; nothing else needs to change.
 */
const DATA_FILE = path.join(process.cwd(), "data", "leads.json");

let writeQueue: Promise<unknown> = Promise.resolve();

async function readAll(): Promise<Lead[]> {
  try {
    return JSON.parse(await readFile(DATA_FILE, "utf8")) as Lead[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function writeAll(leads: Lead[]) {
  await mkdir(path.dirname(DATA_FILE), { recursive: true });
  const tmp = `${DATA_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(leads, null, 2), "utf8");
  await rename(tmp, DATA_FILE);
}

/** Serialises read-modify-write cycles so concurrent webhooks don't clobber each other. */
function mutate<T>(fn: (leads: Lead[]) => T | Promise<T>): Promise<T> {
  const run = writeQueue.then(async () => {
    const leads = await readAll();
    const result = await fn(leads);
    await writeAll(leads);
    return result;
  });
  writeQueue = run.catch(() => {});
  return run;
}

export async function listLeads(): Promise<Lead[]> {
  const leads = await readAll();
  return leads.sort((a, b) => b.startTime.localeCompare(a.startTime));
}

export async function getLead(id: string): Promise<Lead | null> {
  const leads = await readAll();
  return leads.find((l) => l.id === id) ?? null;
}

function event(type: string, detail?: string): LeadEvent {
  return { type, at: new Date().toISOString(), ...(detail ? { detail } : {}) };
}

/**
 * Creates or updates a lead from a Cal.com booking. Dashboard-owned fields (stage, internal
 * notes, history) are kept. Pass `previousId` for a reschedule so the old booking's lead
 * carries over to the new booking uid.
 */
export function upsertFromBooking(
  booking: BookingInput,
  opts: { source: Lead["source"]; eventType: string; previousId?: string | null },
): Promise<Lead> {
  return mutate((leads) => {
    const now = new Date().toISOString();
    const fields = bookingToLeadFields(booking);

    let index = leads.findIndex((l) => l.id === booking.id);
    if (index === -1 && opts.previousId) {
      index = leads.findIndex((l) => l.id === opts.previousId);
    }

    if (index === -1) {
      const lead: Lead = {
        ...fields,
        stage: "new",
        internalNotes: "",
        events: [event(opts.eventType)],
        source: opts.source,
        createdAt: now,
        updatedAt: now,
      };
      leads.push(lead);
      return lead;
    }

    const existing = leads[index];
    const lead: Lead = {
      ...existing,
      ...fields,
      events:
        opts.source === "import" && existing.events.length
          ? existing.events
          : [...existing.events, event(opts.eventType)],
      updatedAt: now,
    };
    leads[index] = lead;
    return lead;
  });
}

export function setBookingStatus(
  id: string,
  status: BookingStatus,
  eventType: string,
  detail?: string | null,
): Promise<Lead | null> {
  return mutate((leads) => {
    const lead = leads.find((l) => l.id === id);
    if (!lead) return null;
    lead.bookingStatus = status;
    if (status === "cancelled" || status === "rejected") lead.cancellationReason = detail ?? null;
    lead.events.push(event(eventType, detail ?? undefined));
    lead.updatedAt = new Date().toISOString();
    return lead;
  });
}

export function addLeadEvent(id: string, type: string, detail?: string): Promise<Lead | null> {
  return mutate((leads) => {
    const lead = leads.find((l) => l.id === id);
    if (!lead) return null;
    lead.events.push(event(type, detail));
    lead.updatedAt = new Date().toISOString();
    return lead;
  });
}

export function updateLeadTracking(
  id: string,
  changes: { stage?: LeadStage; internalNotes?: string },
): Promise<Lead | null> {
  return mutate((leads) => {
    const lead = leads.find((l) => l.id === id);
    if (!lead) return null;
    if (changes.stage && changes.stage !== lead.stage) {
      lead.events.push(event("stage_changed", `${lead.stage} → ${changes.stage}`));
      lead.stage = changes.stage;
    }
    if (changes.internalNotes !== undefined) lead.internalNotes = changes.internalNotes;
    lead.updatedAt = new Date().toISOString();
    return lead;
  });
}

"use server";

import { refresh } from "next/cache";
import { importBookingsFromCal } from "@/lib/cal/api";
import { updateLeadTracking } from "@/lib/leads/store";
import { LEAD_STAGES, type LeadStage } from "@/lib/leads/types";

// The dashboard is protected by proxy.ts (DASHBOARD_PASSWORD); server actions are posted to
// /dashboard routes, so they sit behind the same check.

export async function updateStage(id: string, formData: FormData) {
  const stage = formData.get("stage");
  if (typeof stage !== "string" || !LEAD_STAGES.includes(stage as LeadStage)) {
    throw new Error("Invalid stage");
  }
  await updateLeadTracking(id, { stage: stage as LeadStage });
  refresh();
}

export async function saveInternalNotes(id: string, formData: FormData) {
  const notes = formData.get("internalNotes");
  await updateLeadTracking(id, { internalNotes: typeof notes === "string" ? notes : "" });
  refresh();
}

export type ImportState = { ok: boolean; message: string } | null;

export async function importFromCal(): Promise<ImportState> {
  try {
    const count = await importBookingsFromCal();
    refresh();
    return { ok: true, message: `Imported ${count} booking${count === 1 ? "" : "s"} from Cal.com.` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Import failed." };
  }
}

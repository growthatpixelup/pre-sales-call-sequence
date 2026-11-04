import "server-only";

import { normaliseLinkedIn } from "@/lib/leads/dedup";
import { createLead, findMatchingLead, getLead, logActivity, setStage, updateLead } from "@/lib/leads/store";
import { STAGE_RANK } from "@/lib/leads/types";
import { getAccount, getStakeholder, listMembers, updateStakeholder } from "./store";

/**
 * Where KAM meets the pipeline. A stakeholder who books a call becomes (or joins) a pipeline lead
 * with Source = KAM, and any lead can be attributed to a stakeholder after the fact.
 */

async function originDetail(accountId: string, ownerId: string | null) {
  const [account, members] = await Promise.all([getAccount(accountId), listMembers()]);
  const owner = members.find((m) => m.id === ownerId)?.name;
  return [account?.company, owner].filter(Boolean).join(" · ") || null;
}

/**
 * Marks a stakeholder Call booked and puts them in the pipeline: their open lead if one matches
 * (LinkedIn URL, then the account's domain), else a new lead at Call booked. Returns the lead id.
 */
export async function bookCall(stakeholderId: string): Promise<string> {
  const stakeholder = await getStakeholder(stakeholderId);
  if (!stakeholder) throw new Error("Stakeholder not found.");
  const account = await getAccount(stakeholder.accountId);
  await updateStakeholder(stakeholder.id, { stage: "call_booked" });

  let leadId = stakeholder.leadId;
  if (!leadId) {
    const match = await findMatchingLead({ linkedinUrl: stakeholder.linkedinUrl, domain: account?.domain ?? null });
    if (match) {
      leadId = match.lead.id;
      await attribute(leadId, stakeholder.id);
    } else {
      const lead = await createLead(
        {
          contactName: stakeholder.name,
          company: account?.company ?? null,
          role: stakeholder.role,
          linkedinUrl: stakeholder.linkedinUrl,
          origin: "kam",
          originDetail: await originDetail(stakeholder.accountId, stakeholder.ownerId),
        },
        { stage: "call_booked", website: account?.domain ?? account?.website, activity: "Booked a call through KAM" },
      );
      leadId = lead.id;
      await updateStakeholder(stakeholder.id, { leadId });
    }
  }

  const lead = await getLead(leadId);
  if (lead && STAGE_RANK[lead.stage] < STAGE_RANK.call_booked) await setStage(lead.id, "call_booked", { by: "KAM" });
  return leadId;
}

/**
 * Links a pipeline lead to a KAM stakeholder and credits KAM: Source becomes KAM (the previous
 * source is kept in the timeline).
 */
export async function attribute(leadId: string, stakeholderId: string) {
  const [lead, stakeholder] = await Promise.all([getLead(leadId), getStakeholder(stakeholderId)]);
  if (!lead || !stakeholder) throw new Error("Lead or stakeholder not found.");
  await updateStakeholder(stakeholder.id, { leadId });
  const detail = await originDetail(stakeholder.accountId, stakeholder.ownerId);
  await updateLead(lead.id, {
    origin: "kam",
    originDetail: detail,
    ...(lead.linkedinUrl ? {} : stakeholder.linkedinUrl ? { linkedinUrl: stakeholder.linkedinUrl } : {}),
  });
  await logActivity(
    lead.id,
    "note",
    `Attributed to KAM: ${stakeholder.name}${detail ? ` (${detail})` : ""}. Source was ${lead.origin}${lead.originDetail ? ` · ${lead.originDetail}` : ""}.`,
  );
}

/** Removes the KAM link (the lead keeps its current source). */
export async function unattribute(stakeholderId: string) {
  await updateStakeholder(stakeholderId, { leadId: null });
}

/** Stakeholders that look like this lead, best first: LinkedIn URL, then company domain or name. */
export function suggestStakeholders<T extends { id: string; name: string; linkedinUrl: string | null; accountId: string }>(
  lead: { contactName: string; company: string | null; domain: string | null; linkedinUrl: string | null },
  stakeholders: T[],
  accounts: { id: string; company: string; domain: string | null }[],
): T[] {
  const linkedin = normaliseLinkedIn(lead.linkedinUrl);
  const company = lead.company?.trim().toLowerCase();
  const accountIds = new Set(
    accounts
      .filter((a) => (lead.domain && a.domain?.toLowerCase() === lead.domain) || (company && a.company.trim().toLowerCase() === company))
      .map((a) => a.id),
  );
  const name = lead.contactName.trim().toLowerCase();
  const score = (s: T) =>
    (linkedin && normaliseLinkedIn(s.linkedinUrl) === linkedin ? 4 : 0) +
    (accountIds.has(s.accountId) ? 2 : 0) +
    (name && s.name.trim().toLowerCase() === name ? 1 : 0);
  return stakeholders
    .map((s) => ({ s, n: score(s) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .map((x) => x.s);
}

import Link from "next/link";
import type { ReactNode } from "react";
import { formatMoney } from "@/lib/analytics";
import { DEAL_TYPE_LABELS, ORIGIN_LABELS, leadName, leadValue, type Lead } from "@/lib/leads/types";
import { StageBadge } from "./badges";
import { Tag } from "./ui";

/** A lead as one list row: name, company, stage, value, plus whatever the list is about. */
export function LeadItem({ lead, meta, actions }: { lead: Lead; meta?: ReactNode; actions?: ReactNode }) {
  const value = leadValue(lead);
  return (
    <div className="item">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <StageBadge stage={lead.stage} />
          <Tag tone="neutral">{ORIGIN_LABELS[lead.origin]}</Tag>
          {lead.dealType === "audit" && <Tag tone="neutral">{DEAL_TYPE_LABELS.audit}</Tag>}
        </div>
        <Link href={`/dashboard/leads/${lead.id}`} className="item-title mt-3 inline-block">
          {leadName(lead)}
        </Link>
        <p className="m-0 mt-1 text-[0.92rem] text-muted">
          {[lead.contactName && lead.company ? lead.company : null, lead.owner, value != null ? money(lead) : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {meta && <div className="hint mt-2">{meta}</div>}
      </div>
      {actions && <div className="item-actions">{actions}</div>}
    </div>
  );
}

/** "$12,000" for a closed price, "$12,000 est." for an estimate. */
export function money(lead: Pick<Lead, "closedPrice" | "estimatedPrice">) {
  const value = leadValue(lead);
  if (value == null) return "—";
  return lead.closedPrice != null ? formatMoney(value) : `${formatMoney(value)} est.`;
}

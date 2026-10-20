"use client";

import { useId } from "react";
import { LEAD_STAGES, type LeadStage } from "@/lib/leads/types";
import { STAGE_LABELS } from "./badges";

export function StageSelect({
  stage,
  action,
  compact = false,
}: {
  stage: LeadStage;
  action: (formData: FormData) => void | Promise<void>;
  /** Smaller, for table rows. */
  compact?: boolean;
}) {
  const id = useId();
  return (
    <form action={action}>
      <label className="sr-only" htmlFor={id}>
        Lead stage
      </label>
      <select
        id={id}
        name="stage"
        defaultValue={stage}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className={compact ? "input input-sm" : "input"}
      >
        {LEAD_STAGES.map((s) => (
          <option key={s} value={s}>
            {STAGE_LABELS[s]}
          </option>
        ))}
      </select>
      <noscript>
        <button type="submit" className="action mt-2">
          Save
        </button>
      </noscript>
    </form>
  );
}

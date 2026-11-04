"use client";

import { useId } from "react";
import { EXIT_STAGES, STAGES, STAGE_LABELS, type Stage } from "@/lib/leads/types";

/**
 * Picks a lead's stage and saves on change. Lost and Nurture need a reason, so they're set from
 * the lead page or the Pipeline board instead; a lead already there shows it, disabled.
 */
export function StageSelect({
  stage,
  action,
  compact = false,
}: {
  stage: Stage;
  action: (formData: FormData) => void | Promise<void>;
  /** Smaller, for table rows. */
  compact?: boolean;
}) {
  const id = useId();
  const options = STAGES.filter((s) => !EXIT_STAGES.includes(s) || s === stage);
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
        {options.map((s) => (
          <option key={s} value={s} disabled={EXIT_STAGES.includes(s)}>
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

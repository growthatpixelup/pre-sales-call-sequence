"use client";

import { useState } from "react";
import { EXIT_STAGES, STAGES, STAGE_LABELS, type Stage } from "@/lib/leads/types";

/** Stage picker for the lead page. Lost and Nurture ask for a reason before saving. */
export function StageForm({
  stage,
  reason,
  action,
}: {
  stage: Stage;
  reason: string | null;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [picked, setPicked] = useState<Stage>(stage);
  const exit = EXIT_STAGES.includes(picked);
  const changed = picked !== stage;

  return (
    <form action={action} className="grid gap-2">
      <label className="sr-only" htmlFor="lead-stage">
        Stage
      </label>
      <select
        id="lead-stage"
        name="stage"
        value={picked}
        onChange={(e) => {
          const next = e.currentTarget.value as Stage;
          setPicked(next);
          // Exits wait for the reason; everything else saves straight away.
          if (!EXIT_STAGES.includes(next)) e.currentTarget.form?.requestSubmit();
        }}
        className="input input-sm"
      >
        {STAGES.map((s) => (
          <option key={s} value={s}>
            {STAGE_LABELS[s]}
          </option>
        ))}
      </select>
      {exit && (
        <>
          <input
            name="reason"
            required
            defaultValue={changed ? "" : (reason ?? "")}
            placeholder="Reason (required)"
            aria-label="Reason"
            className="input input-sm"
          />
          <button type="submit" className="action justify-self-start">
            {changed ? `Move to ${STAGE_LABELS[picked]}` : "Save reason"}
          </button>
        </>
      )}
      <noscript>
        <button type="submit" className="action">
          Save
        </button>
      </noscript>
    </form>
  );
}

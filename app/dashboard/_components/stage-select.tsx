"use client";

import { LEAD_STAGES, type LeadStage } from "@/lib/leads/types";
import { STAGE_LABELS } from "./badges";

export function StageSelect({
  stage,
  action,
}: {
  stage: LeadStage;
  action: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <form action={action}>
      <label className="sr-only" htmlFor="stage">
        Lead stage
      </label>
      <select
        id="stage"
        name="stage"
        defaultValue={stage}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      >
        {LEAD_STAGES.map((s) => (
          <option key={s} value={s}>
            {STAGE_LABELS[s]}
          </option>
        ))}
      </select>
      <noscript>
        <button type="submit" className="ml-2 text-sm underline">
          Save
        </button>
      </noscript>
    </form>
  );
}

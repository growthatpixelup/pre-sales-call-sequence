"use client";

import { useActionState } from "react";
import { Icon } from "@/app/dashboard/_components/ui";
import { syncSlackNow, type SyncState } from "../actions";

/** Reads #account-based-marketing now instead of waiting for the 15-minute sync. */
export function SlackSyncButton() {
  const [state, action, pending] = useActionState<SyncState>(syncSlackNow, null);
  return (
    <form action={action} className="grid gap-2">
      <button type="submit" disabled={pending} className="btn">
        {pending ? "Reading Slack…" : "Read Slack updates now"}
        <Icon name="refresh" />
      </button>
      {state && (
        <p role="status" aria-live="polite" className={`m-0 font-mono text-[0.76rem] uppercase ${state.ok ? "text-text" : "text-muted"}`}>
          {state.ok ? "" : "Failed: "}
          {state.message}
        </p>
      )}
    </form>
  );
}

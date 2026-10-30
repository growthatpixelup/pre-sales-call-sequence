"use client";

import { useActionState } from "react";
import { syncFromCal, type SyncState } from "../actions";
import { Icon } from "./ui";

export function SyncButton({ primary = false }: { primary?: boolean }) {
  const [state, action, pending] = useActionState<SyncState>(syncFromCal, null);

  return (
    <form action={action} className="grid gap-2">
      <button type="submit" disabled={pending} className={primary ? "btn-primary" : "btn"}>
        {pending ? "Syncing…" : "Sync from Cal.com"}
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

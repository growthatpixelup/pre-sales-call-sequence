"use client";

import { useActionState } from "react";
import { importFromCal, type ImportState } from "../actions";
import { Icon } from "./ui";

export function ImportButton() {
  const [state, action, pending] = useActionState<ImportState>(importFromCal, null);

  return (
    <form action={action} className="grid gap-2">
      <button type="submit" disabled={pending} className="btn-primary">
        {pending ? "Importing…" : "Import from Cal.com"}
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

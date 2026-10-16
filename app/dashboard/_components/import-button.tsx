"use client";

import { useActionState } from "react";
import { importFromCal, type ImportState } from "../actions";

export function ImportButton() {
  const [state, action, pending] = useActionState<ImportState>(importFromCal, null);

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
      >
        {pending ? "Importing…" : "Import from Cal.com"}
      </button>
      {state && (
        <p
          role="status"
          className={`text-xs ${state.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}

import "server-only";

import type { AlertMessage } from "./slack";
import { formatSlackMessage } from "./slack";

export type AlertSource = "typefully" | "buffer";

export type AlertRow = {
  source: AlertSource;
  platform: string;
  external_id: string;
  url: string;
};

/** Storage for published_post_alerts. The real one is in ./store; tests pass an in-memory one. */
export interface AlertStore {
  /** INSERT ... ON CONFLICT DO NOTHING RETURNING id. Null when the row already existed. */
  insert(row: AlertRow): Promise<string | null>;
  remove(id: string): Promise<void>;
  /** True if any row exists for this source. */
  hasAny(source: AlertSource): Promise<boolean>;
  /** Records rows as already alerted, ignoring duplicates. No Slack message. */
  markSeen(rows: AlertRow[]): Promise<void>;
}

export type Notify = (text: string) => Promise<void>;

export type AlertDeps = { store: AlertStore; notify: Notify };

export type AlertInput = AlertRow & Pick<AlertMessage, "accountLabel" | "text">;

/**
 * Claims the alert in the table, then posts to Slack. If Slack fails, the claim is released so a
 * retry can post it, and the error is rethrown.
 */
export async function sendAlert(input: AlertInput, { store, notify }: AlertDeps): Promise<"sent" | "duplicate"> {
  const { source, platform, external_id, url } = input;
  const id = await store.insert({ source, platform, external_id, url });
  if (!id) return "duplicate";

  try {
    await notify(formatSlackMessage({ platform, accountLabel: input.accountLabel, text: input.text, url }));
  } catch (err) {
    await store.remove(id).catch((removeErr) => {
      console.error("[social-alerts] could not release alert row after Slack failure:", removeErr);
    });
    throw err;
  }
  return "sent";
}

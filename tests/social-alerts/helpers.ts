import type { AlertRow, AlertSource, AlertStore } from "../../lib/social-alerts/alert";

/** In-memory published_post_alerts with the same (source, external_id) uniqueness. */
export function memoryStore() {
  const rows = new Map<string, AlertRow & { id: string }>();
  let next = 1;
  const key = (r: { source: string; external_id: string }) => `${r.source}|${r.external_id}`;
  const store: AlertStore = {
    async insert(row) {
      if (rows.has(key(row))) return null;
      const id = String(next++);
      rows.set(key(row), { ...row, id });
      return id;
    },
    async remove(id) {
      for (const [k, r] of rows) if (r.id === id) rows.delete(k);
    },
    async hasAny(source: AlertSource) {
      return [...rows.values()].some((r) => r.source === source);
    },
    async markSeen(list) {
      for (const row of list) if (!rows.has(key(row))) rows.set(key(row), { ...row, id: String(next++) });
    },
  };
  return { store, rows };
}

/** Records Slack messages instead of sending them. */
export function recorder() {
  const sent: string[] = [];
  return { sent, notify: async (text: string) => void sent.push(text) };
}

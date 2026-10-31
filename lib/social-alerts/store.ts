import "server-only";

import { supabase } from "@/lib/supabase";
import type { AlertRow, AlertSource, AlertStore } from "./alert";

const TABLE = "published_post_alerts";

/** published_post_alerts via the service-role client (the table has RLS on and no policies). */
export function supabaseAlertStore(): AlertStore {
  return {
    async insert(row: AlertRow) {
      // upsert + ignoreDuplicates = INSERT ... ON CONFLICT (source, external_id) DO NOTHING RETURNING id
      const { data, error } = await supabase()
        .from(TABLE)
        .upsert(row, { onConflict: "source,external_id", ignoreDuplicates: true })
        .select("id");
      if (error) throw new Error(`Insert into ${TABLE} failed: ${error.message}`);
      return (data?.[0]?.id as string | undefined) ?? null;
    },

    async remove(id: string) {
      const { error } = await supabase().from(TABLE).delete().eq("id", id);
      if (error) throw new Error(`Delete from ${TABLE} failed: ${error.message}`);
    },

    async hasAny(source: AlertSource) {
      const { data, error } = await supabase().from(TABLE).select("id").eq("source", source).limit(1);
      if (error) throw new Error(`Read from ${TABLE} failed: ${error.message}`);
      return (data?.length ?? 0) > 0;
    },

    async markSeen(rows: AlertRow[]) {
      if (!rows.length) return;
      const { error } = await supabase()
        .from(TABLE)
        .upsert(rows, { onConflict: "source,external_id", ignoreDuplicates: true });
      if (error) throw new Error(`Insert into ${TABLE} failed: ${error.message}`);
    },
  };
}

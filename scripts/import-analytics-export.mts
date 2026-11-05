// Loads X and LinkedIn analytics exports into Supabase (tables from migration 014) for Content OS.
//   LinkedIn: the AggregateAnalytics_….xlsx from LinkedIn → Analytics → Export
//   X:        the account overview and content CSVs from x.com → Analytics → Export data
// Usage: node --env-file=.env --env-file=.env.local --experimental-strip-types --import ./tests/register.mjs scripts/import-analytics-export.mts <file> [<file> …]
// Re-running, or importing overlapping exports, updates the same rows.

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { CREATOR } from "../lib/content/config.ts";
import type { ParsedExport } from "../lib/content/imports.ts";
import { parseLinkedInExport } from "../lib/content/linkedin-export.ts";
import { parseCsv, parseXContent, parseXOverview, xCsvKind } from "../lib/content/x-export.ts";
import { readXlsx } from "../lib/content/xlsx.ts";

const files = process.argv.slice(2);
if (!files.length) {
  console.error("Usage: … scripts/import-analytics-export.mts <file.xlsx|file.csv> [more files]");
  process.exit(1);
}
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SECRET_KEY.");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

function parse(file: string): ParsedExport {
  const buf = readFileSync(file);
  if (/\.xlsx$/i.test(file)) return parseLinkedInExport(readXlsx(buf));
  const rows = parseCsv(buf.toString("utf8"));
  const kind = xCsvKind(rows);
  if (kind === "overview") return parseXOverview(rows);
  if (kind === "content") return parseXContent(rows, CREATOR.x.handle);
  throw new Error("Not a recognised export: expected LinkedIn's .xlsx, or X's overview or content CSV.");
}

const fail = (what: string, message: string) => {
  console.error(`Could not save ${what}: ${message}`);
  if (/does not exist|schema cache/i.test(message)) console.error("Run supabase/migrations/014_content_analytics.sql first.");
  process.exit(1);
};

for (const file of files) {
  let data: ParsedExport;
  try {
    data = parse(file);
  } catch (e) {
    console.error(`${basename(file)}: ${(e as Error).message}`);
    process.exit(1);
  }
  const now = new Date().toISOString();
  // Send only the fields this export has, so a later export never blanks detail from an earlier one.
  const present = <T extends object>(row: T) => Object.fromEntries(Object.entries(row).filter(([, v]) => v != null));
  if (data.days.length) {
    const { error } = await db.from("content_daily").upsert(data.days.map((d) => ({ ...present(d), imported_at: now })));
    if (error) fail("daily numbers", error.message);
  }
  for (let i = 0; i < data.posts.length; i += 500) {
    const { error } = await db.from("content_posts").upsert(data.posts.slice(i, i + 500).map((p) => ({ ...present(p), imported_at: now })));
    if (error) fail("posts", error.message);
  }
  const { error } = await db.from("content_exports").upsert({ ...data.summary, imported_at: now });
  if (error) fail("export summary", error.message);
  const s = data.summary;
  console.log(
    `${basename(file)}: ${s.platform} ${s.kind} ${s.period_from} → ${s.period_to} · ${data.days.length} days · ${data.posts.length} posts` +
      (s.impressions != null ? ` · ${s.impressions.toLocaleString("en-US")} impressions` : "") +
      (s.followers != null ? ` · ${s.followers.toLocaleString("en-US")} followers` : ""),
  );
}

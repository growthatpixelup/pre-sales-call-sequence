# Content OS

`/dashboard/content`: Analytics, Calendar and Swipe for Daksh's X and LinkedIn. No sample data anywhere: a
source without credentials shows "not connected" and names the env vars it needs.

## Where things live

| Path | What |
|---|---|
| `lib/content/sources.ts` | **The data layer.** One loader per source; pages only call these. |
| `lib/content/schedulers/` | Typefully (API v2) and Buffer (GraphQL) readers, read-only, cached 3 minutes |
| `lib/content/config.ts` | Creator handles, Typefully social set (338929), target cadence, outside-tool links |
| `lib/content/analytics.ts`, `calendar.ts`, `swipes.ts` | Pure maths (totals, outliers, merging schedulers, health, filters), tested in `tests/content/` |
| `app/dashboard/content/` | The three pages and shared pieces (`_components/`) |
| `lib/content/mcp.ts`, `app/api/mcp/route.ts` | Read-only MCP server so Claude can pull outliers (see below) |

Every loader returns `ok`, `not_connected` or `error`, and pages render each source on its own, so one failing
source never blanks a page. Light mode follows the system setting on Content pages only.

## Sources

| Source | Env / setup | Gives |
|---|---|---|
| Swipe file | Supabase (migration 013) | Bookmarked posts written by the Grok bot |
| Typefully | `TYPEFULLY_API_KEY` | Calendar (social set 338929, @dakshpixelup); every published post for analytics post counts. Typefully's API has **no analytics** |
| Buffer | `BUFFER_API_KEY`, `BUFFER_ORG_ID`, `CONTENT_BUFFER_CHANNEL_IDS` | Calendar; per-post lifetime metrics (impressions, reactions, comments, reposts, clicks) on Daksh's channels. X only from late Oct 2026, when the X channel was added |
| X / LinkedIn exports | Migration 014, then the import script | True daily impressions and engagements, followers, bookmarks, every post's full metrics |

Analytics merges them, best first: the platform's export for the days it covers, Buffer for later days and posts
the export doesn't list, Typefully for posts neither has (counted, no numbers). The page lists which sources answered.

### Importing exports

1. Run `supabase/migrations/014_content_analytics.sql` in the Supabase SQL Editor (once).
2. Download the exports:
   - LinkedIn: profile → Analytics → Export (pick the longest range) → `AggregateAnalytics_….xlsx`
   - X: x.com → Analytics → Export data (Premium) → the account overview CSV and the content CSV
3. `node --env-file=.env --env-file=.env.local --experimental-strip-types --import ./tests/register.mjs scripts/import-analytics-export.mts <files…>`

Re-import whenever you like: rows upsert. Export files are git-ignored (`*.xlsx`, `*analytics*.csv`).

Calendar notes: a Typefully draft that posts to X and LinkedIn counts once per platform. "Planned" Typefully
posts have a date but won't publish until confirmed, so they don't fill a slot and are flagged as an issue. A post
in both Typefully and Buffer is shown once (same platform, same opening text, within 30 minutes).

## Swipe file contract (for the Grok bot)

Tables: `supabase/migrations/013_swipes.sql`. The page reads them; only the bot writes.

The page shows each swipe's pillar as a tag (no pillar filter). X video media are thumbnails (`*_thumb.jpg`), shown with a play badge linking to the post.

**Columns the page uses:** `platform`, `url`, `author_name`, `author_handle`, `author_avatar_url`, `text`,
`thread`, `quoted`, `media`, `metrics`, `outlier_score`, `analysis`, `pillar`, `hook_pattern`, `posted_at`,
`bookmarked_at` (falls back to `first_seen_at` when null). Swipes sort by `bookmarked_at`.

**jsonb shapes** (snake_case or camelCase keys both work):

```jsonc
// thread: the posts after the first, as strings (or objects with "text")
["second post", "third post"]

// quoted
{ "text": "…", "url": "https://x.com/…", "author_name": "…", "author_handle": "…" }
// or { "text": "…", "url": "…", "author": { "name": "…", "handle": "…" } }

// media: up to 4 shown; items without a url are skipped. kind/type containing "video" or "gif" plays as video.
[{ "kind": "image", "url": "https://…", "alt": "…" }]

// metrics: views|impressions, likes|reactions, comments|replies, reposts|retweets|shares, saves|bookmarks
{ "views": 41200, "likes": 900, "comments": 40, "reposts": 120, "saves": 310 }

// analysis: a swipe without "hook" shows "Breakdown pending"
{
  "hook": "I cold emailed 100 founders…",
  "hook_pattern": "Mini-study",          // the hook_pattern column wins if set
  "format": "Single post",
  "why_it_works": ["…", "…"],
  "skeleton": ["Step 1", "Step 2"],
  "pillar": "Founder lessons",           // the pillar column wins if set; should be one of PILLARS in config.ts
  "borrow": "What to take from it",
  "design": true,                        // the post's design is the point (Media: Design filter)
  "confidence": "high"                   // high | medium | low ("low" shows a tag)
}
```

`outlier_score` is views ÷ the author's median post views (3.4 = 3.4× a typical post).

**Sync runs:** the bot inserts a `swipe_runs` row at start (`status = 'running'`) and updates it at the end with
`finished_at`, `status` (`ok`, `partial` or `failed`), `fetched`, `inserted`, `updated`, `failed` and `error`. The
header shows the last `ok`/`partial` run as "synced 3h ago", and flags a newer `failed` run.

**Things the bot has to do itself:**
- Set `last_synced_at = now()` on every upsert: the column default only applies on insert.
- Keep the `pillar` and `hook_pattern` columns in step with `analysis` (the page prefers the columns).
- Write with the service role key, server side: RLS is on with no policies, like every table here.

## MCP server (Claude reads outliers)

`/api/mcp` is a read-only MCP server (Streamable HTTP, stateless) over the swipe file and Daksh's own analytics,
so Claude can pull outliers for hooks and formats. Off until `CONTENT_MCP_TOKEN` is set (any long random string).
It sits outside `/dashboard`, so the basic-auth gate doesn't apply; the token does.

| Tool | Gives |
|---|---|
| `hook_patterns` | Swipes grouped by hook pattern, format or pillar: count, median/best outlier, top examples |
| `list_outliers` | Swipes at or above an outlier score, filtered by platform, pillar, hook pattern, format, media, text, recency |
| `get_swipe` | One swipe in full (every thread post, media, breakdown), by id or URL |
| `my_outliers` | Daksh's own posts that beat his median, from the analytics sources |

Connect:
- **Claude Code:** `claude mcp add --transport http content-os https://<app>/api/mcp --header "Authorization: Bearer <token>"`
- **Claude Desktop / claude.ai:** Settings → Connectors → Add custom connector → URL `https://<app>/api/mcp?token=<token>`
  (custom connectors can't send headers, so the token goes in the URL; treat that URL as the secret).

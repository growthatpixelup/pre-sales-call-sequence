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

Every loader returns `ok`, `not_connected` or `error`, and pages render each source on its own, so one failing
source never blanks a page. Light mode follows the system setting on Content pages only.

## Sources

| Source | Env | Status |
|---|---|---|
| Swipe file | Supabase (existing keys) | **Live**: tables `swipes`, `swipe_runs` (migration 013), written by the Grok bot |
| Typefully | `TYPEFULLY_API_KEY` (Typefully → Settings → API) | Reads social set 338929 (@dakshpixelup): published, scheduled, planned, drafts, errors |
| Buffer | `BUFFER_API_KEY`, `BUFFER_ORG_ID` (same as the post-is-live alerts); optional `CONTENT_BUFFER_CHANNEL_IDS` | LinkedIn and X channels; set the optional list to only count Daksh's channels |
| X analytics | none yet | Needs an X API plan with impressions; implement `loadAnalytics("x")` |
| LinkedIn analytics | none yet | Needs LinkedIn Community Management API access; implement `loadAnalytics("linkedin")` |

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

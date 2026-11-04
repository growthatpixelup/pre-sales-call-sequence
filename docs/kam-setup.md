# KAM setup

What's left to switch on KAM (spec.md, build step 3) after `supabase/migrations/011_kam.sql`.
Do the steps in order; each says who does it and how to check it worked.

## 1. Slack app: let the bot read the channel

**Who:** whoever admins the Slack app behind `SLACK_BOT_TOKEN` (the one posting "a call was
booked" alerts).

1. api.slack.com/apps → that app → **OAuth & Permissions** → **Bot Token Scopes**, add:
   - `groups:history`: read messages in private channels it's in
   - `users:read`: name the person who posted
   - `users:read.email`: store their email
2. Click **Reinstall to Workspace** (banner at the top) and approve. The token normally stays the
   same; if Slack shows a new `xoxb-…` token, update `SLACK_BOT_TOKEN` in Vercel too.
3. In Slack, open **#account-based-marketing** and run `/invite @<bot name>`.

**Check:** the bot appears in the channel's member list.

## 2. Vercel environment variables

**Who:** whoever has Vercel access. Project → Settings → Environment Variables (Production):

| Name | Value |
|---|---|
| `SLACK_KAM_CHANNEL` | `C0CEKRJCK5Z` (#account-based-marketing) |
| `ANTHROPIC_API_KEY` | the team's Claude API key (same as local `.env`) |

`SLACK_BOT_TOKEN` and `CRON_SECRET` are already set.

## 3. Deploy

Commit and push to `main`; Vercel deploys it. KAM then shows in the dashboard header.

**Check:** open `/dashboard/kam` and press **Read Slack updates now**. It should report how many
updates it read. If it says `needs scope …` or `not_in_channel`, step 1 isn't finished.

## 4. Turn on the 15-minute sync

**Who:** anyone with Supabase SQL access, **after** step 3.

Run `supabase/migrations/012_kam_slack_cron.sql` in the Supabase SQL Editor. It reuses the
`cron_secret` Vault secret from migration 008.

**Check** (a few minutes later):

```sql
select status, return_message, start_time
from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'kam-slack-sync')
order by start_time desc limit 5;
```

## 5. Set up accounts and stakeholders

**Who:** each KAM member, or one person importing from Notion.

- `/dashboard/kam/accounts` → **Add an account** (company, website, owner), then add 2–3
  stakeholders on the account page with their LinkedIn and X URLs.
- The website sets the account's domain, which lets a stakeholder's Cal booking join the same
  pipeline lead instead of creating a second one.
- To bring over the Notion setup instead: export the stakeholder and account databases as CSV
  (⋯ → Export → CSV) and hand them over for a one-off import.

The four members (Daksh, Arjun, Harshil, Monesh) are already set up and linked to their Slack
accounts, so their updates are credited to them. Each works their own accounts and POCs: set
yourself as **owner** on your accounts and POCs, and your page (`/dashboard/kam` → your name)
shows your daily log, accounts and POCs, like the Notion member pages. When an update names a
first name only ("DMed Jane"), your own POCs are checked first.

## 6. Tell the team how to post

Updates go in #account-based-marketing, as a reply to the 6 PM prompt or a normal message.
Suggested line for the Workflow Builder prompt:

> One line per touch: **person · company · what you did · link**. Totals are fine for likes and
> comments ("liked 12, commented 5").

- **Links make matching exact.** Profile or post URLs (LinkedIn or X) match the stakeholder even
  when names are short or misspelt.
- People who aren't stakeholders yet land in **KAM → Review**, where one click assigns them or
  adds them.
- Editing a message re-reads it. Plans ("will DM tomorrow") are ignored.

## Day to day

| Where | What |
|---|---|
| KAM → Team | Today vs targets (15–20 likes & comments, 2–3 DMs), week grid, quick log, going cold |
| KAM → Review | Touches naming someone unmatched |
| KAM → Accounts | Accounts, stakeholders, stages, research notes |
| KAM → KAM wins | KAM revenue, days to close, touches before reply, "how we won it" |
| Lead page → KAM | Attribute any pipeline lead to a stakeholder (sets Source = KAM) |

Setting a stakeholder to **Call booked** puts them in the pipeline (Source = KAM), or links the
lead they already have.

## If something's off

| Symptom | Fix |
|---|---|
| "Set SLACK_BOT_TOKEN and SLACK_KAM_CHANNEL…" | Step 2 |
| `missing_scope` / `needs scope …` | Step 1.1–1.2 |
| `not_in_channel` / `channel_not_found` | Step 1.3 |
| "N Slack updates couldn't be read" on Team | Usually the Claude key or a Claude outage; fix, then **Try again** |
| Touches missing for a day | Press **Read Slack updates now**; check step 4's query |

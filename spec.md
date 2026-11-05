PIXELUP GTM OS — Spec

3 Nov 2026
 · 
@Arjun Sharma


TL;DR: One place for every PIXELUP lead, from first reply to paid, across every channel. It shows what needs doing today, which channels bring revenue, and what's signed vs paid, so nothing slips.

Purpose and principles
The GTM OS is one place to see every PIXELUP lead's stage, from first reply to paid, across every channel.

One leads table, one Stage field. Every dashboard is either a feeder into that table or a view on it.

A lead starts at the first two-way signal: a reply, a Cal booking, an email to Daksh, or a Contra client response. Outreach volume (invites, jobs scraped) stays as counts, not records.

Read-only where a tool owns the data. Gojiberry and Valley are read, never controlled, from the OS.

Every lead keeps its Origin (first touch) and its booking source, so channels get credited correctly.

Lead model
Every lead moves through seven stages, with one exit for lost or parked deals.

Engaged

Call booked

Call held (or No-show)

Proposal sent

Negotiating

Won (contract signed)

Paid (deposit cleared)

Anyone can move a lead's stage manually at any time, from the lead page or by dragging its card on the Pipeline board.

Exit: Lost / Nurture, with a required reason. Audit deals (the ~3K outbound offer, no call before purchase) can go straight from Engaged to Paid, then spawn a separate Project deal.

Group

Fields

Who

Company, contact, role, email, LinkedIn URL, funding stage, ICP fit

Origin

Source (Cal, Contra, Outbound, X outreach, Founder inbox, KAM, Inbound, Referral program), sub-source (LinkedIn account, campaign, referrer, Contra job, UTM), owner

Status

Stage, deal type (Audit / Project), estimated price, closed price, next action + due date, last touch

Context

Cal booking answers, pre-call sequence status, Fireflies transcript, proposal link, lost reason

Each lead also carries one activity timeline covering DMs, emails, sequence emails, calls and proposals.

Navigation and home page
Home is the landing page: what needs attention, the period's numbers, and one tile per dashboard.

Sidebar: Home, Today, Pipeline, Sources, Money, then the channel dashboards: Booked calls, Contra, Outbound, X outreach, Founder inbox, KAM, Inbound, Referral program (coming soon).

Home, top to bottom:

Needs attention strip: pre-call emails to personalise and LinkedIn notes to send, overdue follow-ups, Founder inbox threads and X replies waiting on Daksh, LinkedIn account issues, unpaid invoices past due, KAM members behind today's target.

Period numbers (week / month toggle): new leads, calls booked, show rate, proposals out, won, paid.

Dashboard tiles: each shows 2–3 numbers, a small trend line and one alert line, and clicks through to its dashboard.

Tile

Shows

Booked calls

Calls today and this week, show rate, emails to personalise

Contra

New rubric-passing jobs, applied, client responses

Outbound

Reply rate and calls booked per account, account health

X outreach

Accounts to qualify this week, DMs sent, replies waiting on Daksh

Founder inbox

Active threads, waiting on us, gone quiet

KAM

Team progress vs daily targets, replies this week, KAM wins

Inbound

Leads by source this week, top source

Pipeline

Value by stage

Money

Won vs paid vs outstanding

Referral program

Coming soon

Each dashboard exposes one summary query for its tile; Home only combines them, so a new channel means one new tile.

Core views
Four views read from the leads table and cover action, status, channel performance and cash.

View

Answers

Contents

Today

What do I do now?

Calls today with booking answers inline, pre-call emails to personalise, overdue next actions, leads silent 5+ days, proposals awaiting a reply

Pipeline

Where does every deal stand?

Kanban by stage; filters for owner, source, deal type; estimated vs closed value

Sources

Which channel deserves more effort?

Funnel per source (engaged → booked → held → proposal → won → paid), revenue by source

Money

What's signed vs collected?

Won vs paid vs outstanding, by month

Metrics to track across views: show rate, call → proposal, proposal → won, won → paid lag, days to close, revenue per source, audit → project conversion.

Channel dashboards
Each channel keeps its own detail and hands a lead to the pipeline once it becomes a two-way conversation.

Booked calls (Cal) — exists
Each booking creates or updates a lead at Call booked, deduped by email and company domain.

Pages (from the existing Call Leads dashboard): Overview, Leads, Tasks, Emails, Replies.

Emails: the Resend pre-call sequence, per email over 30 days: sent, queued, drafts, skipped, cancelled, failed. Also "going out next" and a sent log per lead. Skipped = the email didn't fit before the call.

Sequence: Booking confirmation · Email 1: Case study + proof · Email 2: How we work · Email 3: What to expect · Reminder: 1 hour before · Reminder: no-show nudge.

Tasks: what to do before each call, with counts for urgent, emails, LinkedIn and stuck.

Emails to personalise: when a call is booked, a task is created for the sequence email that needs a personalised line. The team writes the line and sends that email manually.

LinkedIn notes to send: one per upcoming call.

Each lead's record shows which sequence emails went out, plus show / no-show after the call.

Add a required "How did you find us?" dropdown to the Cal form, and per-channel UTMs on Cal links.

Contra — exists
Claude scrapes the Contra job board daily via Contra MCP and adds every job that passes the rubric, each with a direct apply link. The team applies from the dashboard without opening Contra.

Each job moves Found → Applied → Client responded. Jobs stay on the Contra page; once a client responds, the job becomes a lead in the pipeline at Engaged.

LinkedIn outbound (read-only)
Data: a sync every few hours pulls Gojiberry and Valley into a snapshot table (account × campaign × day). Read endpoints only; the dashboard holds no API keys.

Filters: date range, tool, LinkedIn account (all three), campaign.

KPIs: invites sent, acceptance rate, messages sent, reply rate, positive reply rate, calls booked, audits bought.

Panels: three-account comparison with account health (connection status, invite usage vs LinkedIn limits), sortable campaign table, weekly trend, reply feed tagged by intent with links into the tool.

Attribution: per-account and per-campaign Cal links with UTMs; fallback match on email or LinkedIn URL.

X outreach (Daksh)
Daksh's manual DMs to warm X accounts: people who follow him or engage with his content.

Sourcing: weekly. The existing sheet of warm accounts stays the input and syncs into this page; each week's new accounts land as Sourced. Later, the Apify X scraper could fill the sheet from Daksh's followers and post engagers.

Stages: Sourced → Qualified or Not a fit → DM sent → Replied → Conversation → Call booked (enters the pipeline with Source = X outreach).

Fields: X handle, name, company, role, how they engaged (follow, like, comment, reply, repost) with a link, fit reason, DM date, last touch, next step, notes.

Views: this week's batch to qualify, DM queue (qualified, not yet messaged), replies waiting on Daksh, and stats: sourced, qualified rate, DMs sent, reply rate, calls booked, revenue.

Overlap: handles already in KAM or the pipeline are flagged, so nobody gets a duplicate DM.

Founder inbox
Leads who email Daksh directly instead of booking a call, often because a past client referred them.

Capture: a script in Daksh's own Google account checks new inbound threads every hour. Threads from past-client domains, or flagged by a classifier as new-business inquiries, get a "Founder inbox" Gmail label. Daksh can also add the label by hand, or remove it to exclude a thread.

Sync: only labeled threads reach the GTM OS: contact, company, subject, message count, last-message dates, who sent last, and a short summary. Everything else stays in his inbox.

In the OS: each thread becomes a lead with Source = Founder inbox, owner Daksh, and a "Referred by" field. Stage and prices are set manually like any lead; "waiting on us vs them" and days since last message fill in automatically.

Fallbacks: BCC a capture address, or a weekly 10-minute sync with Daksh.

KAM
Tables: Accounts (company, owner) · Stakeholders (person, role, LinkedIn/X URL, stage) · Activity log (date, member, stakeholder, type, platform, link, note).

Stakeholder stages: Identified → Engaging → DM sent → Replied → Conversation → Call booked (enters the pipeline).

Targets per member: 3–5 companies, ~10 stakeholders, ~15–20 comments and likes plus 2–3 DMs a day.

Views: daily check-in with a seconds-long quick log, account board, team week, going cold (no touch in 7+ days).

KAM wins: a filtered pipeline view where Origin = KAM.

Leads are auto-tagged when a stakeholder reaches Call booked.

An "Attribute a lead" picker links any pipeline lead to a KAM account and stakeholder, with suggested matches on email, LinkedIn URL or domain.

Each win records: stakeholder, owner, deal type, value, paid status, days from first touch to close, touches before first reply, and a "how we won it" note.

Header stats: KAM revenue, deals won, average days to close, average touches before reply.

Later: auto-log the team's X comments with the Apify X scraper.

Inbound
Sources: SEO and AI search, Design for B2B, Clutch / DesignRush, Medium, organic X / LinkedIn, website email.

Capture: UTMs on every owned link; Cal's "How did you find us?" with a ChatGPT / Perplexity / AI search option; directory emails forwarded to the capture address; DMs logged with the quick-add form.

Shows: leads per source per week, UTM vs self-reported source, conversion per source.

Referral program — coming soon
A proper referral program: anyone who refers a client earns 15% of the total project value. It appears in the dashboard as "Referral program — coming soon" until it launches.

Data and sync
Pages never call Gojiberry, Valley or Gmail live; they read only stored data. Dedup matches on email first, then LinkedIn URL, then company domain, and a merged lead keeps both its first-touch and booking sources.

Build order and open questions
Start with the leads table and existing feeds, then add channels in order of how few dependencies they have.

Leads table and dedup, with Cal and Contra feeding it; Pipeline and Today views.

Cal "How did you find us?" field and UTMs, so attribution data starts accruing early.

KAM dashboard, including KAM wins (internal, no integrations).

LinkedIn outbound sync and dashboard (needs Gojiberry and Valley API access), plus the X outreach page.

Founder inbox sync (needs Daksh's buy-in), then the referral program.

Sources, Money and the Home tiles.

Open questions


What are the Cal and Contra dashboards built on, and does the leads table live in the same stack?


Is Daksh's email on Google Workspace (needed for the Founder inbox sync)?


Which of the three LinkedIn accounts run on Gojiberry vs Valley?


Do Gojiberry and Valley offer read-only API keys?


Where are payments recorded today, to drive Paid status?


Which KAM columns from the Notion setup carry over as-is?


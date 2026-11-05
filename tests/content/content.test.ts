import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { change, median, totals, withOutliers } from "../../lib/content/analytics";
import { buildCalendar, mergeSchedulers, openSlotTimes, targetSlots } from "../../lib/content/calendar";
import { CADENCE } from "../../lib/content/config";
import { buckets, resolvePeriod } from "../../lib/content/periods";
import { fromSwipeRow, type SwipeRow } from "../../lib/content/sources";
import { filterSwipes, swipeStats } from "../../lib/content/swipes";
import type { DailyMetrics, Post, ScheduledPost, Swipe } from "../../lib/content/types";
import { fromTypefullyDraft, type TypefullyDraft } from "../../lib/content/schedulers/typefully";
import { analyticsFromSent, type SentPostLike } from "../../lib/content/buffer-analytics";
import { fromBufferPost, platformOf } from "../../lib/content/schedulers/buffer";

const post = (id: string, views: number, handle = "me"): Post => ({
  id,
  platform: "x",
  url: `https://x.com/${handle}/status/${id}`,
  author: { name: handle, handle, avatarUrl: null },
  text: id,
  thread: [],
  quoted: null,
  media: [],
  metrics: { views, likes: 0, comments: 0, reposts: 0, saves: 0 },
  publishedAt: "2026-11-01T10:00:00Z",
  outlier: null,
});

describe("periods", () => {
  it("resolves a period and the same-length period before it", () => {
    const r = resolvePeriod("28d", "2026-11-05");
    assert.deepEqual([r.from, r.to, r.days, r.unit], ["2026-10-09", "2026-11-05", 28, "day"]);
    assert.deepEqual(r.previous, { from: "2026-09-11", to: "2026-10-08" });
    assert.equal(resolvePeriod("ytd", "2026-11-05").from, "2026-01-01");
    assert.equal(resolvePeriod("90d", "2026-11-05").unit, "week");
  });

  it("buckets by calendar month, clipped to the range", () => {
    const b = buckets({ from: "2026-01-15", to: "2026-03-10" }, "month");
    assert.deepEqual(b.map((x) => [x.from, x.to]), [
      ["2026-01-15", "2026-01-31"],
      ["2026-02-01", "2026-02-28"],
      ["2026-03-01", "2026-03-10"],
    ]);
  });
});

describe("analytics", () => {
  it("scores outliers against the author's median post", () => {
    const scored = withOutliers([post("a", 100), post("b", 200), post("c", 300), post("d", 1000, "other")]);
    assert.deepEqual(scored.map((p) => p.outlier), [0.5, 1, 1.5, 1]);
    assert.equal(median([]), null);
  });

  it("sums a range and compares periods", () => {
    const day = (date: string, impressions: number, followers: number): DailyMetrics => ({
      date, impressions, engagements: impressions / 10, posts: 1, likes: 0, comments: 0, reposts: 0, saves: 0,
      newFollowers: 1, followers, repliesSent: 0, repostsSent: 0,
    });
    const t = totals([day("2026-11-01", 100, 10), day("2026-11-02", 300, 12), day("2026-11-03", 999, 99)], { from: "2026-11-01", to: "2026-11-02" });
    assert.equal(t.impressions, 400);
    assert.equal(t.followers, 12);
    assert.equal(t.engagementRate, 0.1);
    assert.equal(change(120, 100), 0.2);
    assert.equal(change(5, 0), null);
  });
});

describe("calendar", () => {
  const item = (fields: Partial<ScheduledPost>): ScheduledPost => ({
    id: Math.random().toString(36),
    scheduler: "typefully",
    platform: "x",
    status: "scheduled",
    at: "2026-11-06T04:00:00Z",
    text: "Hello world",
    url: null,
    error: null,
    ...fields,
  });

  it("keeps a post that's in both schedulers once, with the furthest status", () => {
    const merged = mergeSchedulers([
      item({ scheduler: "typefully" }),
      item({ scheduler: "buffer", at: "2026-11-06T04:04:00Z", status: "published", url: "https://x.com/a/status/1", text: "Hello   World https://t.co/x" }),
      item({ scheduler: "buffer", at: "2026-11-06T09:00:00Z" }), // same text, hours apart: a different post
      item({ scheduler: "buffer", platform: "linkedin" }), // other platform
    ]);
    assert.equal(merged.length, 3);
    assert.deepEqual(merged[0].schedulers, ["typefully", "buffer"]);
    assert.equal(merged[0].status, "published");
    assert.equal(merged[0].url, "https://x.com/a/status/1");
  });

  it("targets X twice a day and LinkedIn on Monday, Wednesday and Friday", () => {
    assert.deepEqual(targetSlots("2026-11-05", CADENCE.x), ["17:00", "21:00"]);
    const week = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"];
    assert.deepEqual(week.map((d) => targetSlots(d, CADENCE.linkedin).length), [1, 0, 1, 0, 1, 0, 0]);
  });

  it("calls an empty queue dry and lists open slots", () => {
    const view = buildCalendar([], new Date("2026-11-05T06:00:00Z"), "UTC");
    assert.equal(view.health, "dry");
    assert.equal(view.runwayDays, 0);
    assert.equal(view.next7.filled, 0);
    assert.ok(view.issues.some((i) => i.includes("open X slot")));
    assert.equal(view.weeks.length, 4);
    assert.equal(view.weeks[1].some((d) => d.isToday), true);
  });

  it("calls a full queue with a clean history healthy", () => {
    const now = new Date("2026-11-05T00:30:00Z");
    const posts: ScheduledPost[] = [];
    for (let i = -14; i < 10; i++) {
      const day = new Date(Date.UTC(2026, 10, 5 + i)).toISOString().slice(0, 10);
      for (const platform of ["x", "linkedin"] as const) {
        targetSlots(day, CADENCE[platform]).forEach((slot, k) => {
          const at = `${day}T${slot}:00Z`;
          posts.push(item({ platform, at, text: `${platform} ${day} ${k}`, status: Date.parse(at) < now.getTime() ? "published" : "scheduled" }));
        });
      }
    }
    const view = buildCalendar(mergeSchedulers(posts), now, "UTC");
    assert.equal(view.health, "healthy");
    assert.equal(view.next7.filled, view.next7.target);
    assert.ok(view.runwayDays >= 7);
    assert.deepEqual(view.issues, []);
  });
});

describe("swipe file", () => {
  const swipe = (id: string, fields: Partial<Swipe>): Swipe => ({
    ...post(id, 100),
    savedAt: "2026-11-01T00:00:00Z",
    analysis: null,
    ...fields,
  });
  const analysis = (pillar: string, design = false) => ({
    hook: "h", hookPattern: "p", format: "f", whyItWorks: [], skeleton: [], pillar, borrow: "b", design, confidence: "high" as const,
  });
  const swipes: Swipe[] = [
    swipe("a", { platform: "linkedin", outlier: 1.2, savedAt: "2026-11-04T00:00:00Z", analysis: analysis("B2C") }),
    swipe("b", { outlier: 3.1, savedAt: "2026-11-03T00:00:00Z", analysis: analysis("Growth & brand", true), media: [{ kind: "image", url: "https://x/a.jpg", alt: "" }] }),
    swipe("c", { outlier: 5, savedAt: "2026-11-02T00:00:00Z", analysis: analysis("Growth & brand", true) }),
    swipe("d", { outlier: null, savedAt: "2026-11-05T00:00:00Z" }),
  ];
  const run = (id: string, status: "ok" | "failed" | "partial", at: string) => ({
    id, startedAt: at, finishedAt: at, trigger: "schedule" as const, status, fetched: 0, inserted: 0, updated: 0, failed: 0, error: null,
  });
  const runs = [run("run-1", "ok", "2026-11-04T00:00:00Z"), run("run-3", "partial", "2026-11-05T00:00:00Z"), run("run-4", "failed", "2026-11-05T06:00:00Z")];

  it("filters by platform, pillar and media, and sorts by outlier", () => {
    const linkedin = filterSwipes(swipes, { platform: "linkedin", pillar: "all", media: "any", order: "newest" });
    assert.ok(linkedin.length > 0 && linkedin.every((s) => s.platform === "linkedin"));
    const design = filterSwipes(swipes, { platform: "both", pillar: "Growth & brand", media: "design", order: "outlier" });
    assert.deepEqual(design.map((s) => s.id), ["c", "b"]);
    const outliers = design.map((s) => s.outlier ?? 0);
    assert.deepEqual(outliers, [...outliers].sort((a, b) => b - a));
    const text = filterSwipes(swipes, { platform: "both", pillar: "all", media: "text", order: "newest" });
    assert.ok(text.every((s: Swipe) => s.media.length === 0));
  });

  it("reports the last successful sync, not the last attempt", () => {
    const stats = swipeStats(swipes, runs);
    assert.equal(stats.lastSync?.id, "run-3");
    assert.equal(stats.count, swipes.length);
  });

  it("reads a row shaped like the bot's swipes table", () => {
    const row = {
      id: "1",
      platform: "x",
      external_id: "123",
      url: "https://x.com/a/status/123",
      author_name: "Ann",
      author_handle: "ann",
      author_avatar_url: null,
      text: "Hook line",
      thread: ["two", { text: "three" }],
      quoted: { author: { name: "Bo", handle: "bo" }, text: "quoted", url: "https://x.com/bo/status/9" },
      media: [{ type: "photo", url: "https://pbs.twimg.com/a.jpg" }, { type: "video", url: "https://video.twimg.com/b.mp4" }, { type: "photo" }],
      metrics: { impressions: 1000, likes: 50, replies: 3, retweets: 4, bookmarks: 9 },
      outlier_score: "3.4",
      analysis: { hook: "Hook line", hookPattern: "Big claim", why_it_works: ["a"], skeleton: ["1"], borrow: "x", design: true, confidence: "low" },
      pillar: "Growth",
      hook_pattern: null,
      posted_at: null,
      bookmarked_at: null,
      first_seen_at: "2026-11-01T00:00:00Z",
    } as unknown as SwipeRow;
    const s = fromSwipeRow(row);
    assert.deepEqual(s.thread, ["two", "three"]);
    assert.equal(s.quoted?.author.handle, "bo");
    assert.deepEqual(s.media.map((m) => m.kind), ["image", "video"]);
    assert.deepEqual(s.metrics, { views: 1000, likes: 50, comments: 3, reposts: 4, saves: 9 });
    assert.equal(s.outlier, 3.4);
    assert.equal(s.savedAt, "2026-11-01T00:00:00Z");
    assert.equal(s.analysis?.hookPattern, "Big claim");
    assert.equal(s.analysis?.pillar, "Growth");
    assert.equal(s.analysis?.design, true);
    assert.equal(s.analysis?.confidence, "low");
  });
});

describe("swipe avatars", () => {
  const base = {
    id: "1", url: "https://x.com/a/status/1", author_name: "Ann", text: "t", thread: [], quoted: null, media: [],
    metrics: {}, outlier_score: null, analysis: null, pillar: null, hook_pattern: null, posted_at: null,
    bookmarked_at: null, first_seen_at: "2026-11-01T00:00:00Z",
  };

  it("uses the saved picture, else the X picture by handle", () => {
    const saved = fromSwipeRow({ ...base, platform: "x", author_handle: "ann", author_avatar_url: "https://pbs.twimg.com/p.jpg" } as unknown as SwipeRow);
    assert.equal(saved.author.avatarUrl, "https://pbs.twimg.com/p.jpg");
    const looked = fromSwipeRow({ ...base, platform: "x", author_handle: "@ann_b", author_avatar_url: null } as unknown as SwipeRow);
    assert.equal(looked.author.avatarUrl, "https://unavatar.io/x/ann_b");
  });

  it("has no LinkedIn lookup, so shows initials without a saved picture", () => {
    const li = fromSwipeRow({ ...base, platform: "linkedin", author_handle: "ann-b", author_avatar_url: null } as unknown as SwipeRow);
    assert.equal(li.author.avatarUrl, null);
  });
});

describe("Typefully", () => {
  // Shape from Daksh's real Typefully account (list drafts, API v2).
  const draft = (fields: Partial<TypefullyDraft>): TypefullyDraft => ({
    id: 11621522,
    status: "draft",
    preview: "Had so much fun building interactions for replay .ai\n\nthis is their “how it works” section. four...",
    draft_title: null,
    scheduled_date: null,
    published_at: null,
    private_url: "https://typefully.com/?d=11621522&a=338929",
    x_post_enabled: true,
    linkedin_post_enabled: false,
    x_post_published_at: null,
    linkedin_post_published_at: null,
    x_published_url: null,
    linkedin_published_url: null,
    ...fields,
  });

  it("turns a draft into one post per enabled platform", () => {
    const [x] = fromTypefullyDraft(draft({}));
    assert.equal(x.status, "draft");
    assert.equal(x.at, null);
    assert.equal(x.url, "https://typefully.com/?d=11621522&a=338929");
    const both = fromTypefullyDraft(draft({ status: "scheduled", scheduled_date: "2026-11-06T06:30:00Z", linkedin_post_enabled: true }));
    assert.deepEqual(both.map((p) => [p.platform, p.status, p.at]), [
      ["x", "scheduled", "2026-11-06T06:30:00Z"],
      ["linkedin", "scheduled", "2026-11-06T06:30:00Z"],
    ]);
  });

  it("uses each platform's own publish time and link, and keeps planned apart", () => {
    const [x, li] = fromTypefullyDraft(
      draft({
        status: "published",
        linkedin_post_enabled: true,
        published_at: "2026-11-04T06:30:00Z",
        x_post_published_at: "2026-11-04T06:30:05Z",
        x_published_url: "https://x.com/dakshpixelup/status/1",
      }),
    );
    assert.deepEqual([x.status, x.at, x.url], ["published", "2026-11-04T06:30:05Z", "https://x.com/dakshpixelup/status/1"]);
    assert.equal(li.status, "failed"); // published on X only
    assert.equal(fromTypefullyDraft(draft({ status: "planned", scheduled_date: "2026-11-08T06:30:00Z" }))[0].status, "planned");
  });
});

describe("Buffer", () => {
  it("maps services and statuses", () => {
    assert.equal(platformOf("linkedin"), "linkedin");
    assert.equal(platformOf("twitter"), "x");
    assert.equal(platformOf("instagram"), null);
    const node = { id: "p1", text: "Hello", status: "sent", dueAt: "2026-11-04T06:00:00Z", sentAt: "2026-11-04T06:00:09Z", createdAt: null, externalLink: "https://www.linkedin.com/feed/update/1", channelId: "c1", error: null };
    assert.deepEqual(
      [fromBufferPost(node, "linkedin")?.status, fromBufferPost(node, "linkedin")?.at],
      ["published", "2026-11-04T06:00:09Z"],
    );
    const failed = fromBufferPost({ ...node, status: "error", error: { message: "Token expired" } }, "linkedin");
    assert.deepEqual([failed?.status, failed?.error], ["failed", "Token expired"]);
    assert.equal(fromBufferPost({ ...node, status: "draft" }, "x")?.at, null);
    assert.equal(fromBufferPost({ ...node, status: "something_new" }, "x"), null);
  });

  it("merges a Typefully preview with Buffer's full copy of the same post", () => {
    const full = "Had so much fun building interactions for replay .ai\n\nthis is their “how it works” section. four steps, each one animated on scroll.";
    const merged = mergeSchedulers([
      { id: "t", scheduler: "typefully", platform: "linkedin", status: "scheduled", at: "2026-11-06T06:30:00Z", text: full.slice(0, 98) + "...", url: null, error: null },
      { id: "b", scheduler: "buffer", platform: "linkedin", status: "scheduled", at: "2026-11-06T06:31:00Z", text: full, url: null, error: null },
    ]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].text, full);
    assert.deepEqual(merged[0].schedulers, ["typefully", "buffer"]);
  });
});

describe("swipe rows as the bot writes them", () => {
  it("keeps X video thumbnails as posters and sharpens avatars", () => {
    const s = fromSwipeRow({
      id: "v", platform: "x", url: "https://x.com/a/status/1", author_name: "A", author_handle: "a",
      author_avatar_url: "https://pbs.twimg.com/profile_images/1/abc_normal.jpg", text: "t", thread: [], quoted: null,
      media: [
        { alt: null, url: "https://pbs.twimg.com/amplify_video_thumb/2/img/x.jpg", type: "video", preview_url: "https://pbs.twimg.com/amplify_video_thumb/2/img/x.jpg" },
        { alt: null, url: "https://pbs.twimg.com/tweet_video_thumb/y.jpg", type: "animated_gif", preview_url: null },
        { alt: null, url: "https://pbs.twimg.com/media/z.jpg", type: "photo" },
      ],
      metrics: { likes: 1, saves: 2, views: 3, quotes: 0, reposts: 0, comments: 0 }, outlier_score: 6.41,
      analysis: { hook: "h", hook_pattern: "Unpopular opinion", is_design: false, confidence: "med", why_it_works: ["x"], skeleton: [], borrow: "b", pillar: "Design & AI" },
      pillar: "Design & AI", hook_pattern: "Unpopular opinion", posted_at: null, bookmarked_at: "2026-11-05T11:49:33Z", first_seen_at: "2026-11-05T11:49:33Z",
    } as unknown as SwipeRow);
    assert.equal(s.author.avatarUrl, "https://pbs.twimg.com/profile_images/1/abc_200x200.jpg");
    assert.deepEqual(s.media.map((m) => [m.kind, m.url, m.poster ?? null]), [
      ["video", null, "https://pbs.twimg.com/amplify_video_thumb/2/img/x.jpg"],
      ["video", null, "https://pbs.twimg.com/tweet_video_thumb/y.jpg"],
      ["image", "https://pbs.twimg.com/media/z.jpg", null],
    ]);
    assert.equal(s.analysis?.confidence, "medium");
    assert.equal(s.analysis?.pillar, "Design & AI");
  });
});

describe("Buffer analytics", () => {
  it("builds per-day numbers from Buffer's per-post metrics", () => {
    const sent: SentPostLike[] = [
      { id: "1", platform: "x" as const, text: "a", sentAt: "2026-11-03T15:30:00Z", url: "https://x.com/dakshpixelup/status/1", metrics: { impressions: 5501, reactions: 219, comments: 8, reposts: 11, clicks: 0 } },
      { id: "2", platform: "x" as const, text: "b", sentAt: "2026-11-03T11:30:00Z", url: null, metrics: { impressions: 2499, reactions: 81, comments: 2, reposts: 1, clicks: 4 } },
      { id: "3", platform: "linkedin" as const, text: "c", sentAt: "2026-11-02T15:00:00Z", url: null, metrics: { impressions: 764 } },
    ];
    const x = analyticsFromSent(sent, "x", "Asia/Kolkata");
    assert.equal(x.posts.length, 2);
    assert.deepEqual(x.daily.map((d) => [d.date, d.posts, d.impressions, d.engagements, d.followers]), [["2026-11-03", 2, 8000, 326, null]]);
    assert.equal(x.posts[0].metrics.saves, null);
    assert.equal(x.posts[0].outlier, 1.4); // 5501 ÷ median(5501, 2499)
    assert.equal(analyticsFromSent(sent, "linkedin", "Asia/Kolkata").daily[0].date, "2026-11-02");
  });
});

describe("open slots", () => {
  it("leaves open the slot no post is near", () => {
    const at = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
    assert.deepEqual(openSlotTimes(["12:00", "17:00", "21:00"], [at("12:00"), at("21:00")]), ["17:00"]);
    assert.deepEqual(openSlotTimes(["12:00", "17:00", "21:00"], [at("20:45")]), ["12:00", "17:00"]);
    assert.deepEqual(openSlotTimes(["12:00"], [at("09:00"), at("10:00")]), []);
  });
});

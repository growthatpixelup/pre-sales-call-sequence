import type { ReactNode } from "react";
import { formatDate } from "@/lib/format";
import { formatCompact, formatPct } from "@/lib/content/format";
import { PLATFORM_LABELS, engagementRate, type Media, type Post } from "@/lib/content/types";
import { CopyButton } from "@/app/dashboard/_components/copy-button";
import { Icon } from "@/app/dashboard/_components/ui";
import { Avatar } from "./kit";

/** A post as a card: author, outlier score, full text, thread, quote, media, metrics, copy. */
export function PostCard({ post, children }: { post: Post; children?: ReactNode }) {
  const er = engagementRate(post.metrics);
  const copyText = [post.text, ...post.thread].join("\n\n");
  return (
    <article className="flex min-w-0 flex-col border border-line bg-bg">
      <div className="flex items-start gap-3 p-4 pb-0 sm:p-5 sm:pb-0">
        <Avatar name={post.author.name} url={post.author.avatarUrl} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-text">{post.author.name}</div>
          <div className="flex flex-wrap items-center gap-x-2 text-[0.85rem] text-muted">
            {post.author.handle && <span className="truncate">@{post.author.handle}</span>}
            <PlatformTag platform={post.platform} />
          </div>
        </div>
        <OutlierBadge value={post.outlier} />
      </div>

      <div className="flex flex-1 flex-col gap-4 p-4 sm:p-5">
        <p className="m-0 text-[0.95rem] whitespace-pre-line text-body">{post.text}</p>

        {post.thread.length > 0 && (
          <details className="group">
            <summary className="mono-label cursor-pointer list-none hover:text-text">
              <span className="group-open:hidden">Show thread ({post.thread.length} more)</span>
              <span className="hidden group-open:inline">Hide thread</span>
            </summary>
            <ol className="m-0 mt-3 grid list-none gap-3 border-l border-line-2 p-0 pl-4">
              {post.thread.map((t, i) => (
                <li key={i} className="text-[0.95rem] whitespace-pre-line text-body">
                  {t}
                </li>
              ))}
            </ol>
          </details>
        )}

        {post.quoted && (
          <a
            href={post.quoted.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block border border-line p-3 text-inherit no-underline hover:border-line-2"
          >
            <div className="flex items-center gap-2 text-[0.85rem]">
              <Avatar name={post.quoted.author.name} url={post.quoted.author.avatarUrl} size={20} />
              <span className="font-medium text-text">{post.quoted.author.name}</span>
              <span className="text-muted">@{post.quoted.author.handle}</span>
            </div>
            <p className="m-0 mt-2 text-[0.9rem] whitespace-pre-line text-body">{post.quoted.text}</p>
          </a>
        )}

        {post.media.length > 0 && <MediaGrid media={post.media.slice(0, 4)} />}

        {children}
      </div>

      <footer className="border-t border-line px-4 py-3 sm:px-5">
        <dl className="m-0 flex flex-wrap gap-x-4 gap-y-1 text-[0.82rem] text-muted tabular-nums">
          <Metric label="Views" value={formatCompact(post.metrics.views)} />
          {post.metrics.likes != null && <Metric label="Likes" value={formatCompact(post.metrics.likes)} />}
          {post.metrics.comments != null && <Metric label="Comments" value={formatCompact(post.metrics.comments)} />}
          {post.metrics.saves != null && <Metric label="Saves" value={formatCompact(post.metrics.saves)} />}
          <Metric label="Eng. rate" value={formatPct(er)} />
        </dl>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <a href={post.url} target="_blank" rel="noopener noreferrer" className="link inline-flex items-center gap-1 text-[0.85rem]">
            {formatDate(post.publishedAt)}
            <Icon name="external" />
            <span className="sr-only">(open the original on {PLATFORM_LABELS[post.platform]})</span>
          </a>
          <CopyButton text={copyText} />
        </div>
      </footer>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1">
      <dt>{label}</dt>
      <dd className="m-0 text-text">{value}</dd>
    </div>
  );
}

export function PlatformTag({ platform }: { platform: Post["platform"] }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[0.7rem] tracking-[0.06em] text-muted uppercase">
      <span aria-hidden className={`size-2 ${platform === "x" ? "bg-series-x" : "bg-series-li"}`} />
      {PLATFORM_LABELS[platform]}
    </span>
  );
}

/** "3.4x": views against the account's median post. Highlighted from 2x. */
export function OutlierBadge({ value }: { value: number | null }) {
  if (value == null) return null;
  const strong = value >= 2;
  return (
    <span
      className={`shrink-0 px-2 py-1 font-mono text-[0.78rem] tabular-nums ${strong ? "bg-blue text-on-accent" : "bg-panel text-muted"}`}
      title={`${value}x the views of this account's median post`}
    >
      {value.toFixed(1)}x<span className="sr-only"> the account&apos;s median views</span>
    </span>
  );
}

function MediaGrid({ media }: { media: Media[] }) {
  return (
    <div className={`grid gap-0.5 ${media.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
      {media.map((m, i) => (
        <div
          key={i}
          className={`relative overflow-hidden bg-panel-2 ${media.length === 3 && i === 0 ? "row-span-2" : ""} ${media.length === 1 ? "aspect-video" : "aspect-[4/3]"}`}
        >
          {m.url && m.kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={m.url} alt={m.alt} loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
          ) : m.url && m.kind === "video" ? (
            <video src={m.url} controls preload="none" className="absolute inset-0 h-full w-full object-cover" aria-label={m.alt} />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-3 text-center" role="img" aria-label={m.alt}>
              <span className="mono-label">{m.kind === "video" ? "▶ Video" : "Image"}</span>
              <span className="line-clamp-2 text-[0.75rem] text-hint">{m.alt}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

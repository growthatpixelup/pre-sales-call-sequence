import { Fragment } from "react";
import type { Media, Swipe } from "@/lib/content/types";
import { CopyButton } from "@/app/dashboard/_components/copy-button";
import { Avatar } from "../_components/avatar";
import { ClampedText } from "./clamped-text";

const whole = new Intl.NumberFormat("en-US");
const date = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

/** One bookmarked post: exactly as posted, then a one-line "why it works" that opens up. */
export function SwipeCard({ swipe }: { swipe: Swipe }) {
  const { author, metrics, analysis: a } = swipe;
  return (
    <article className="mb-4 break-inside-avoid border border-line bg-panel/40 p-5">
      <header className="flex items-start gap-3">
        <Avatar name={author.name} url={author.avatarUrl} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-1.5">
            <span className="truncate font-medium text-text">{author.name}</span>
            {swipe.platform === "linkedin" && <span className="text-[0.85rem] text-link">· LinkedIn</span>}
          </div>
          {author.handle && <div className="truncate text-[0.9rem] text-muted">@{author.handle}</div>}
        </div>
        {swipe.outlier != null && (
          <span
            className="shrink-0 border border-blue bg-[color-mix(in_oklab,var(--blue)_22%,var(--bg))] px-2 py-1 font-mono text-[0.8rem] text-text tabular-nums"
            title={`${swipe.outlier}x the views of ${author.name}'s median post`}
          >
            {swipe.outlier.toFixed(1)}x
          </span>
        )}
      </header>

      <ClampedText>
        <Linkified text={swipe.text} />
      </ClampedText>

      {swipe.thread.length > 0 && (
        <details className="group mt-3">
          <summary className="cursor-pointer list-none text-[0.9rem] text-muted hover:text-text">
            <span className="group-open:hidden">Show thread ({swipe.thread.length} more)</span>
            <span className="hidden group-open:inline">Hide thread</span>
          </summary>
          <ol className="m-0 mt-3 grid list-none gap-3 border-l border-line-2 p-0 pl-4">
            {swipe.thread.map((t, i) => (
              <li key={i} className="whitespace-pre-line text-body">
                <Linkified text={t} />
              </li>
            ))}
          </ol>
        </details>
      )}

      {swipe.quoted && (
        <a
          href={swipe.quoted.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 block border border-line p-3 text-inherit no-underline hover:border-line-2"
        >
          <div className="flex items-center gap-2 text-[0.85rem]">
            <Avatar name={swipe.quoted.author.name} url={swipe.quoted.author.avatarUrl} size={20} />
            <span className="font-medium text-text">{swipe.quoted.author.name}</span>
            {swipe.quoted.author.handle && <span className="text-muted">@{swipe.quoted.author.handle}</span>}
          </div>
          <p className="m-0 mt-2 text-[0.92rem] whitespace-pre-line text-body">{swipe.quoted.text}</p>
        </a>
      )}

      {swipe.media.length > 0 && <MediaGrid media={swipe.media.slice(0, 4)} postUrl={swipe.url} />}

      {a ? (
        <details className="group mt-4 border-t border-line pt-3">
          <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-[0.92rem] text-body hover:text-text">
            <span aria-hidden className="text-[0.7rem] text-muted transition-transform group-open:rotate-90">▸</span>
            <span>{a.hookPattern || "Why it works"}</span>
            {a.pillar && (
              <span className="border border-line-2 px-2 py-0.5 font-mono text-[0.68rem] tracking-[0.08em] text-muted uppercase">
                {a.pillar}
              </span>
            )}
            {a.design && (
              <span className="border border-line-2 px-2 py-0.5 font-mono text-[0.68rem] tracking-[0.08em] text-muted uppercase">Design</span>
            )}
            {a.confidence === "low" && (
              <span className="px-1 font-mono text-[0.68rem] tracking-[0.08em] text-hint uppercase">Low confidence</span>
            )}
          </summary>
          <div className="mt-3 grid gap-4 text-[0.92rem]">
            {a.hook && (
              <p className="m-0 text-body">
                <span className="mono-label">Hook </span>“{a.hook}”
              </p>
            )}
            {a.whyItWorks.length > 0 && (
              <ul className="bullets m-0">
                {a.whyItWorks.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
            {a.skeleton.length > 0 && (
              <div>
                <p className="mono-label m-0 mb-2">Skeleton</p>
                <ol className="m-0 grid gap-1 pl-5 text-body">
                  {a.skeleton.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              </div>
            )}
            {a.borrow && (
              <p className="m-0 border-l-2 border-blue pl-3 text-body">
                <strong className="text-text">Borrow:</strong> {a.borrow}
              </p>
            )}
          </div>
        </details>
      ) : (
        <p className="m-0 mt-4 border-t border-line pt-3 text-[0.85rem] text-hint">Breakdown pending: the bot adds it on its next run.</p>
      )}

      <footer className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[0.9rem] text-muted tabular-nums">
        {metrics.likes != null && <span>{whole.format(metrics.likes)} likes</span>}
        {metrics.comments != null && <span>{whole.format(metrics.comments)} comments</span>}
        {metrics.views > 0 && <span>{whole.format(metrics.views)} views</span>}
        <span className="ml-auto flex items-center gap-3">
          <a href={swipe.url} target="_blank" rel="noopener noreferrer" className="text-muted no-underline hover:text-text hover:underline">
            {date.format(new Date(swipe.publishedAt))}
          </a>
          <CopyButton plain text={[swipe.text, ...swipe.thread].join("\n\n")} />
        </span>
      </footer>
    </article>
  );
}

/** Plain text with its links made clickable. */
function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s)]+)/g);
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-link no-underline hover:underline">
            {part.replace(/^https?:\/\/(www\.)?/, "")}
          </a>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

function MediaGrid({ media, postUrl }: { media: Media[]; postUrl: string }) {
  return (
    <div className={`mt-4 grid gap-0.5 ${media.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
      {media.map((m, i) => (
        <div key={i} className={`relative overflow-hidden bg-panel-2 ${media.length === 1 ? "" : "aspect-square"} ${media.length === 3 && i === 0 ? "row-span-2 aspect-auto" : ""}`}>
          {m.kind === "video" && m.url ? (
            <video src={m.url} poster={m.poster ?? undefined} controls preload="metadata" className="h-full w-full object-cover" aria-label={m.alt} />
          ) : m.kind === "video" && m.poster ? (
            <a href={postUrl} target="_blank" rel="noopener noreferrer" className={media.length === 1 ? "relative block" : "absolute inset-0"}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={m.poster} alt={m.alt || "Video thumbnail"} loading="lazy" referrerPolicy="no-referrer" className={media.length === 1 ? "block h-auto w-full" : "h-full w-full object-cover"} />
              <span className="absolute bottom-2 left-2 bg-black/70 px-2 py-1 font-mono text-[0.72rem] text-white">▶ Play</span>
            </a>
          ) : m.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={m.url}
              alt={m.alt}
              loading="lazy"
              referrerPolicy="no-referrer"
              className={media.length === 1 ? "block h-auto w-full" : "absolute inset-0 h-full w-full object-cover"}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}

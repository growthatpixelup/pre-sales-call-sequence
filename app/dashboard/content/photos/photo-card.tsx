"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { PhotoView } from "@/lib/content/photo-library";
import { deletePhoto, editPhoto, markUnused, markUsed, prepareUploads, swapPhotoFile } from "./actions";
import { heicToJpeg, looksHeic } from "./heic";
import { dimensions, putToStorage } from "./upload";

const date = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

function size(bytes: number | null) {
  if (bytes == null) return null;
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** One photo: the image, its tags and caption, and the used / edit / download / delete controls. */
export function PhotoCard({ photo }: { photo: PhotoView }) {
  const [broken, setBroken] = useState(false);
  const [mode, setMode] = useState<"view" | "edit" | "use" | "delete">("view");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fix = useHeicFix(photo);

  const run = (fn: () => Promise<void>) =>
    start(async () => {
      setError(null);
      try {
        await fn();
        setMode("view");
      } catch (e) {
        setError(e instanceof Error ? e.message : "That didn't work; try again.");
      }
    });

  const meta = [
    photo.takenAt ? date.format(new Date(photo.takenAt)) : null,
    photo.width && photo.height ? `${photo.width}×${photo.height}` : null,
    size(photo.sizeBytes),
  ].filter(Boolean);

  return (
    <article className="mb-4 break-inside-avoid border border-line bg-panel/40" aria-busy={pending}>
      <a href={photo.src ?? undefined} target="_blank" rel="noopener noreferrer" className="relative block bg-panel">
        {photo.src && !broken ? (
          // Signed Storage URLs change on every load, so next/image's optimiser would only add a hop.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo.src}
            alt={photo.caption ?? photo.fileName ?? "Photo"}
            loading="lazy"
            decoding="async"
            width={photo.width ?? undefined}
            height={photo.height ?? undefined}
            onError={() => setBroken(true)}
            className="block h-auto w-full outline outline-1 -outline-offset-1 outline-black/10"
          />
        ) : (
          <div className="grid aspect-[4/3] place-items-center p-4 text-center text-[0.9rem] text-muted">
            {fix.state === "converting" ? "Converting HEIC to JPEG…" : fix.state === "failed" ? "Couldn't convert this HEIC." : "Preview unavailable."}
          </div>
        )}
        {photo.usedAt && (
          <span className="absolute top-3 left-3 bg-blue px-2 py-1 font-mono text-[0.72rem] tracking-[0.06em] text-on-accent uppercase">
            Used {date.format(new Date(photo.usedAt))}
          </span>
        )}
      </a>

      <div className="grid gap-3 p-4">
        {mode === "edit" ? (
          <form action={(fd) => run(() => editPhoto(photo.id, fd))} className="grid gap-3">
            <label className="field">
              <span className="mono-label">Caption</span>
              <textarea name="caption" defaultValue={photo.caption ?? ""} rows={2} className="input input-sm w-full resize-y" placeholder="Where, when, what it's good for" />
            </label>
            <label className="field">
              <span className="mono-label">Tags</span>
              <input name="tags" defaultValue={photo.tags.join(", ")} className="input input-sm w-full" placeholder="stage, office, headshot" />
            </label>
            <div className="flex gap-2">
              <button type="submit" className="action action-blue" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </button>
              <button type="button" className="action" onClick={() => setMode("view")} disabled={pending}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <>
            {photo.caption && <p className="m-0 text-body whitespace-pre-line">{photo.caption}</p>}
            {photo.tags.length > 0 && (
              <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="Tags">
                {photo.tags.map((t) => (
                  <li key={t} className="border border-line-2 px-2 py-0.5 font-mono text-[0.68rem] tracking-[0.08em] text-muted uppercase">
                    {t}
                  </li>
                ))}
              </ul>
            )}
            {meta.length > 0 && <p className="m-0 text-[0.85rem] text-hint tabular-nums">{meta.join(" · ")}</p>}
            {photo.postUrl && (
              <a href={photo.postUrl} target="_blank" rel="noopener noreferrer" className="link text-[0.9rem]">
                See the post
              </a>
            )}
          </>
        )}

        {mode === "use" && (
          <form action={(fd) => run(() => markUsed(photo.id, fd))} className="grid gap-2">
            <label className="field">
              <span className="mono-label">Post link (optional)</span>
              <input name="postUrl" type="url" className="input input-sm w-full" placeholder="https://www.linkedin.com/posts/…" />
            </label>
            <div className="flex gap-2">
              <button type="submit" className="action action-blue" disabled={pending}>
                {pending ? "Saving…" : "Mark used"}
              </button>
              <button type="button" className="action" onClick={() => setMode("view")} disabled={pending}>
                Cancel
              </button>
            </div>
          </form>
        )}

        {mode === "delete" && (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Confirm delete">
            <span className="text-[0.9rem] text-bad">Delete this photo for good?</span>
            <button type="button" className="action" disabled={pending} onClick={() => run(() => deletePhoto(photo.id))}>
              {pending ? "Deleting…" : "Delete"}
            </button>
            <button type="button" className="action" onClick={() => setMode("view")} disabled={pending}>
              Keep
            </button>
          </div>
        )}

        {fix.state === "failed" && (
          <p role="alert" className="m-0 flex flex-wrap items-center gap-2 text-[0.85rem] text-bad">
            {fix.error}
            <button type="button" className="action" onClick={fix.retry}>
              Try again
            </button>
          </p>
        )}

        {mode === "view" && (
          <div className="flex flex-wrap gap-2 border-t border-line pt-3">
            {photo.downloadUrl && (
              <a href={photo.downloadUrl} className="action">
                Download
              </a>
            )}
            {photo.usedAt ? (
              <button type="button" className="action" disabled={pending} onClick={() => run(() => markUnused(photo.id))}>
                Unmark used
              </button>
            ) : (
              <button type="button" className="action" onClick={() => setMode("use")}>
                Mark used
              </button>
            )}
            <button type="button" className="action" onClick={() => setMode("edit")}>
              Edit
            </button>
            <button type="button" className="action ml-auto" onClick={() => setMode("delete")} aria-label="Delete photo">
              Delete
            </button>
          </div>
        )}

        {error && (
          <p role="alert" className="m-0 text-[0.85rem] text-bad">
            {error}
          </p>
        )}
      </div>
    </article>
  );
}

/**
 * Photos stored as HEIC before uploads converted them: fetch the original, turn it into a JPEG in
 * the browser, upload that and point the row at it. Runs once per card, on its own.
 */
function useHeicFix(photo: PhotoView) {
  const needed = looksHeic({ name: photo.fileName, type: photo.contentType }) && Boolean(photo.src);
  const [state, setState] = useState<"idle" | "converting" | "failed">(needed ? "converting" : "idle");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const started = useRef(-1);

  useEffect(() => {
    if (!needed || !photo.src || started.current === attempt) return;
    started.current = attempt;
    const src = photo.src;
    (async () => {
      try {
        setState("converting");
        const original = await fetch(src);
        if (!original.ok) throw new Error(`Couldn't fetch the original (${original.status}).`);
        const jpeg = await heicToJpeg(await original.blob(), photo.fileName ?? "photo.heic");
        const target = await prepareUploads([{ name: jpeg.name, type: jpeg.type, size: jpeg.size }]);
        if (!target.ok) throw new Error(target.message);
        const [, size] = await Promise.all([putToStorage(target.data[0].signedUrl, jpeg), dimensions(jpeg)]);
        const swapped = await swapPhotoFile(photo.id, {
          path: target.data[0].path,
          fileName: jpeg.name,
          contentType: jpeg.type,
          sizeBytes: jpeg.size,
          ...size,
        });
        if (!swapped.ok) throw new Error(swapped.message);
        // refresh() in the action re-renders the page with the JPEG's URL.
      } catch (e) {
        setError(e instanceof Error ? e.message : "Conversion failed.");
        setState("failed");
      }
    })();
  }, [needed, photo.src, photo.id, photo.fileName, attempt]);

  return { state: needed ? state : "idle", error, retry: () => setAttempt((n) => n + 1) } as const;
}

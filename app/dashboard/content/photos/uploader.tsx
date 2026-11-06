"use client";

import { useRef, useState, useTransition } from "react";
import { PHOTO_TYPES, uploadProblem } from "@/lib/content/photo-library";
import { prepareUploads, savePhotos } from "./actions";

type NewPhoto = Parameters<typeof savePhotos>[0][number];

/** Width and height, when the browser can decode the file (it can't decode HEIC outside Safari). */
async function dimensions(file: File): Promise<{ width: number | null; height: number | null }> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return { width: null, height: null };
  }
}

/** Drop or pick photos; each goes straight to Supabase Storage, then gets a row in `photos`. */
export function PhotoUploader() {
  const input = useRef<HTMLInputElement>(null);
  const [tags, setTags] = useState("");
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [pending, start] = useTransition();

  function upload(list: FileList | File[]) {
    const all = [...list];
    if (!all.length) return;
    const problems = all.map(uploadProblem).filter((p): p is string => Boolean(p));
    const files = all.filter((f) => !uploadProblem(f));
    if (!files.length) {
      setStatus({ ok: false, message: problems.join(" ") });
      return;
    }
    start(async () => {
      setStatus(null);
      setProgress({ done: 0, total: files.length });
      const targets = await prepareUploads(files.map((f) => ({ name: f.name, type: f.type, size: f.size })));
      if (!targets.ok) {
        setProgress(null);
        setStatus({ ok: false, message: targets.message });
        return;
      }
      const saved: NewPhoto[] = [];
      const failed: string[] = [...problems];
      let done = 0;
      await Promise.all(
        files.map(async (file, i) => {
          const target = targets.data[i];
          try {
            const [res, size] = await Promise.all([
              fetch(target.signedUrl, {
                method: "PUT",
                body: file,
                headers: { "content-type": file.type, "x-upsert": "false", "cache-control": "max-age=3600" },
              }),
              dimensions(file),
            ]);
            if (!res.ok) throw new Error(`${res.status}`);
            saved.push({
              path: target.path,
              fileName: file.name,
              contentType: file.type,
              sizeBytes: file.size,
              ...size,
              takenAt: file.lastModified ? new Date(file.lastModified).toISOString() : null,
              caption: null,
              tags: [],
            });
          } catch {
            failed.push(`${file.name} didn't upload.`);
          } finally {
            done += 1;
            setProgress({ done, total: files.length });
          }
        }),
      );
      const result = saved.length ? await savePhotos(saved, tags) : null;
      setProgress(null);
      if (result && !result.ok) failed.push(result.message);
      else if (saved.length) setTags("");
      setStatus({
        ok: failed.length === 0,
        message: [saved.length && result?.ok ? `Added ${saved.length} photo${saved.length === 1 ? "" : "s"}.` : "", ...failed].filter(Boolean).join(" "),
      });
      if (input.current) input.current.value = "";
    });
  }

  return (
    <div className="grid gap-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!pending) upload(e.dataTransfer.files);
        }}
        data-dragging={dragging}
        className="flex flex-wrap items-center gap-4 border border-dashed border-line-2 p-5 data-[dragging=true]:border-blue data-[dragging=true]:bg-[color-mix(in_oklab,var(--blue)_12%,var(--bg))]"
      >
        <button type="button" className="action action-blue" disabled={pending} onClick={() => input.current?.click()}>
          {pending ? "Uploading…" : "Add photos"}
        </button>
        <input
          ref={input}
          type="file"
          accept={PHOTO_TYPES.join(",")}
          multiple
          hidden
          onChange={(e) => e.target.files && upload(e.target.files)}
        />
        <label className="flex min-w-[240px] flex-1 items-center gap-3">
          <span className="mono-label shrink-0">Tags</span>
          <input
            className="input input-sm flex-1"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="Applied to this upload, e.g. stage, office, headshot"
            disabled={pending}
          />
        </label>
        <span className="text-[0.9rem] text-muted">or drop photos here · up to 50 MB each</span>
      </div>
      <p role="status" aria-live="polite" className={`m-0 text-[0.9rem] ${status && !status.ok ? "text-bad" : "text-muted"}`}>
        {progress ? `Uploading ${progress.done} of ${progress.total}…` : status?.message}
      </p>
    </div>
  );
}

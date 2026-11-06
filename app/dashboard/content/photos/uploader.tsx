"use client";

import { useRef, useState, useTransition } from "react";
import { PHOTO_TYPES, uploadProblem } from "@/lib/content/photo-library";
import { prepareUploads, savePhotos } from "./actions";
import { looksHeic } from "./heic";
import { dimensions, putToStorage, storable } from "./upload";

type NewPhoto = Parameters<typeof savePhotos>[0][number];

/** Drop or pick photos; HEIC becomes JPEG, then each goes straight to Supabase Storage and gets a row. */
export function PhotoUploader() {
  const input = useRef<HTMLInputElement>(null);
  const [tags, setTags] = useState("");
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function upload(list: FileList | File[]) {
    const picked = [...list];
    if (!picked.length) return;
    start(async () => {
      setStatus(null);
      const failed: string[] = [];

      // 1. HEIC → JPEG, in the browser.
      const heic = picked.filter((f) => looksHeic(f)).length;
      if (heic) setProgress(`Converting ${heic} HEIC photo${heic === 1 ? "" : "s"} to JPEG…`);
      const converted = await Promise.all(
        picked.map(async (f) => {
          try {
            return await storable(f);
          } catch {
            failed.push(`${f.name} couldn't be converted from HEIC.`);
            return null;
          }
        }),
      );
      const files: File[] = [];
      for (const f of converted) {
        if (!f) continue;
        const problem = uploadProblem(f);
        if (problem) failed.push(problem);
        else files.push(f);
      }
      if (!files.length) {
        setProgress(null);
        setStatus({ ok: false, message: failed.join(" ") });
        return;
      }

      // 2. Signed upload URLs, then the files go straight to Storage.
      setProgress(`Uploading 0 of ${files.length}…`);
      const targets = await prepareUploads(files.map((f) => ({ name: f.name, type: f.type, size: f.size })));
      if (!targets.ok) {
        setProgress(null);
        setStatus({ ok: false, message: targets.message });
        return;
      }
      const saved: NewPhoto[] = [];
      let done = 0;
      await Promise.all(
        files.map(async (file, i) => {
          const target = targets.data[i];
          try {
            const [, size] = await Promise.all([putToStorage(target.signedUrl, file), dimensions(file)]);
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
            setProgress(`Uploading ${done} of ${files.length}…`);
          }
        }),
      );

      // 3. One row per stored file.
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
          accept={[...PHOTO_TYPES, ".heic", ".heif"].join(",")}
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
        <span className="text-[0.9rem] text-muted">or drop photos here · HEIC is saved as JPEG · up to 50 MB each</span>
      </div>
      <p role="status" aria-live="polite" className={`m-0 text-[0.9rem] ${status && !status.ok ? "text-bad" : "text-muted"}`}>
        {progress ?? status?.message}
      </p>
    </div>
  );
}

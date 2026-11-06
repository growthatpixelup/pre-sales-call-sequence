"use server";

import { refresh } from "next/cache";
import { parseTags } from "@/lib/content/photo-library";
import {
  createUploadTargets,
  deletePhoto as removePhoto,
  insertPhotos,
  replacePhotoFile,
  updatePhoto,
  type NewPhoto,
  type UploadRequest,
  type UploadTarget,
} from "@/lib/content/photos";

// Photo library actions. Like every /dashboard route, these sit behind proxy.ts.

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; message: string };

const failure = (e: unknown): { ok: false; message: string } => ({ ok: false, message: e instanceof Error ? e.message : String(e) });

/** Step 1 of an upload: one signed URL per file, which the browser PUTs the file to. */
export async function prepareUploads(files: UploadRequest[]): Promise<Result<UploadTarget[]>> {
  try {
    if (!Array.isArray(files) || !files.length || files.length > 50) throw new Error("Pick between 1 and 50 photos.");
    return { ok: true, data: await createUploadTargets(files) };
  } catch (e) {
    return failure(e);
  }
}

/** Step 2: record the files that made it into Storage. */
export async function savePhotos(photos: NewPhoto[], tagsInput: string): Promise<Result> {
  try {
    const tags = parseTags(tagsInput ?? "");
    await insertPhotos(photos.map((p) => ({ ...p, tags: [...new Set([...p.tags, ...tags])] })));
    refresh();
    return { ok: true, data: undefined };
  } catch (e) {
    return failure(e);
  }
}

/** Swaps a stored HEIC for the JPEG the browser made from it and uploaded. */
export async function swapPhotoFile(id: string, file: Parameters<typeof replacePhotoFile>[1]): Promise<Result> {
  try {
    if (file.contentType !== "image/jpeg") throw new Error("Expected a JPEG.");
    await replacePhotoFile(id, file);
    refresh();
    return { ok: true, data: undefined };
  } catch (e) {
    return failure(e);
  }
}

export async function editPhoto(id: string, formData: FormData) {
  const caption = formData.get("caption");
  const tags = formData.get("tags");
  await updatePhoto(id, {
    caption: typeof caption === "string" && caption.trim() ? caption.trim().slice(0, 500) : null,
    tags: typeof tags === "string" ? parseTags(tags) : [],
  });
  refresh();
}

export async function markUsed(id: string, formData: FormData) {
  const url = formData.get("postUrl");
  const postUrl = typeof url === "string" && /^https?:\/\//.test(url.trim()) ? url.trim() : null;
  await updatePhoto(id, { used_at: new Date().toISOString(), post_url: postUrl });
  refresh();
}

export async function markUnused(id: string) {
  await updatePhoto(id, { used_at: null, post_url: null });
  refresh();
}

export async function deletePhoto(id: string) {
  await removePhoto(id);
  refresh();
}

import "server-only";

import { supabase } from "@/lib/supabase";
import { NotConnected } from "./errors";
import { photoPath, uploadProblem, type Photo, type PhotoView } from "./photo-library";

/** Photo library store: table `photos` and the private Storage bucket `photos` (migration 015). */

export const PHOTO_BUCKET = "photos";
/** Signed view/download URLs last an hour; the page re-signs on every load. */
const URL_TTL = 60 * 60;

function db() {
  if (!process.env.SUPABASE_URL || !(process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)) {
    throw new NotConnected(["SUPABASE_URL", "SUPABASE_SECRET_KEY"]);
  }
  return supabase();
}

interface PhotoRow {
  id: string;
  path: string;
  file_name: string | null;
  content_type: string | null;
  size_bytes: number | string | null;
  width: number | null;
  height: number | null;
  caption: string | null;
  tags: string[] | null;
  taken_at: string | null;
  used_at: string | null;
  post_url: string | null;
  created_at: string;
}

function fromRow(r: PhotoRow): Photo {
  return {
    id: r.id,
    path: r.path,
    fileName: r.file_name,
    contentType: r.content_type,
    sizeBytes: r.size_bytes == null ? null : Number(r.size_bytes),
    width: r.width,
    height: r.height,
    caption: r.caption,
    tags: r.tags ?? [],
    takenAt: r.taken_at,
    usedAt: r.used_at,
    postUrl: r.post_url,
    createdAt: r.created_at,
  };
}

export async function readPhotos(): Promise<PhotoView[]> {
  const client = db();
  const { data, error } = await client.from("photos").select("*").order("created_at", { ascending: false });
  if (error) {
    // PGRST205: the table doesn't exist yet.
    throw new Error(error.code === "PGRST205" ? "Run supabase/migrations/015_photos.sql in the Supabase SQL editor first." : error.message);
  }
  const photos = (data as PhotoRow[]).map(fromRow);
  if (!photos.length) return [];

  const paths = photos.map((p) => p.path);
  const bucket = client.storage.from(PHOTO_BUCKET);
  const [view, download] = await Promise.all([
    bucket.createSignedUrls(paths, URL_TTL),
    bucket.createSignedUrls(paths, URL_TTL, { download: true }),
  ]);
  if (view.error) throw new Error(view.error.message);
  const urlFor = (list: typeof view.data | null, path: string) => list?.find((x) => x.path === path)?.signedUrl ?? null;
  return photos.map((p) => ({ ...p, src: urlFor(view.data, p.path), downloadUrl: urlFor(download.data, p.path) ?? urlFor(view.data, p.path) }));
}

export interface UploadRequest {
  name: string;
  type: string;
  size: number;
}

export interface UploadTarget {
  path: string;
  signedUrl: string;
}

/** Signed upload URLs (valid 2 hours) the browser PUTs each file to. */
export async function createUploadTargets(files: UploadRequest[]): Promise<UploadTarget[]> {
  const problem = files.map(uploadProblem).find(Boolean);
  if (problem) throw new Error(problem);
  const bucket = db().storage.from(PHOTO_BUCKET);
  return Promise.all(
    files.map(async (f) => {
      const path = photoPath(f.name, crypto.randomUUID());
      const { data, error } = await bucket.createSignedUploadUrl(path);
      if (error || !data) throw new Error(error?.message ?? "Storage didn't return an upload URL.");
      return { path, signedUrl: data.signedUrl };
    }),
  );
}

export interface NewPhoto {
  path: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  takenAt: string | null;
  caption: string | null;
  tags: string[];
}

export async function insertPhotos(photos: NewPhoto[]): Promise<void> {
  if (!photos.length) return;
  const { error } = await db()
    .from("photos")
    .insert(
      photos.map((p) => ({
        path: p.path,
        file_name: p.fileName,
        content_type: p.contentType,
        size_bytes: p.sizeBytes,
        width: p.width,
        height: p.height,
        taken_at: p.takenAt,
        caption: p.caption,
        tags: p.tags,
      })),
    );
  if (error) throw new Error(error.message);
}

export async function updatePhoto(
  id: string,
  patch: Partial<{ caption: string | null; tags: string[]; used_at: string | null; post_url: string | null }>,
): Promise<void> {
  const { error } = await db().from("photos").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deletePhoto(id: string): Promise<void> {
  const client = db();
  const { data, error } = await client.from("photos").select("path").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return;
  const removed = await client.storage.from(PHOTO_BUCKET).remove([data.path as string]);
  if (removed.error) throw new Error(removed.error.message);
  const { error: delError } = await client.from("photos").delete().eq("id", id);
  if (delError) throw new Error(delError.message);
}

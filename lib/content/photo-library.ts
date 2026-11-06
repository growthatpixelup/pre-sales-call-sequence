/** Photo library filters, tags and upload checks. Pure. */

export interface Photo {
  id: string;
  path: string;
  fileName: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  caption: string | null;
  tags: string[];
  takenAt: string | null;
  usedAt: string | null;
  postUrl: string | null;
  createdAt: string;
}

/** A photo with signed URLs to show and download it. */
export interface PhotoView extends Photo {
  src: string | null;
  downloadUrl: string | null;
}

export const PHOTO_STATUSES = ["all", "unused", "used"] as const;
export type PhotoStatus = (typeof PHOTO_STATUSES)[number];

export const PHOTO_ORDERS = ["newest", "taken"] as const;
export type PhotoOrder = (typeof PHOTO_ORDERS)[number];

export interface PhotoFilters {
  status: PhotoStatus;
  /** A tag, or "all". */
  tag: string;
  order: PhotoOrder;
}

export const MAX_PHOTO_BYTES = 50 * 1024 * 1024;
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/gif"];

/** "Stage, Event , stage" → ["stage", "event"]. Lowercase, trimmed, no duplicates. */
export function parseTags(input: string): string[] {
  const out: string[] = [];
  for (const raw of input.split(/[,#\n]/)) {
    const t = raw.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 40);
    if (t && !out.includes(t)) out.push(t);
  }
  return out.slice(0, 20);
}

const time = (s: string | null) => (s ? Date.parse(s) : 0);

export function filterPhotos<T extends Photo>(photos: T[], f: PhotoFilters): T[] {
  const tag = f.tag.toLowerCase();
  return photos
    .filter(
      (p) =>
        (f.status === "all" || (f.status === "used" ? p.usedAt != null : p.usedAt == null)) &&
        (f.tag === "all" || p.tags.includes(tag)),
    )
    .sort((a, b) =>
      f.order === "taken"
        ? time(b.takenAt ?? b.createdAt) - time(a.takenAt ?? a.createdAt)
        : time(b.createdAt) - time(a.createdAt),
    );
}

/** Every tag with how many photos carry it, most used first. */
export function tagCounts(photos: Photo[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const p of photos) for (const t of p.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** Why a file can't be uploaded, or null when it can. */
export function uploadProblem(file: { name: string; type: string; size: number }): string | null {
  if (!PHOTO_TYPES.includes(file.type)) return `${file.name} isn't a JPEG, PNG, WebP, HEIC or GIF.`;
  if (file.size > MAX_PHOTO_BYTES) return `${file.name} is over 50 MB.`;
  if (file.size <= 0) return `${file.name} is empty.`;
  return null;
}

/** A Storage path that keeps the original name readable: "2026/11/<uuid>-stage-shot.jpg". */
export function photoPath(fileName: string, id: string, now = new Date()): string {
  const dot = fileName.lastIndexOf(".");
  const ext = dot > 0 ? fileName.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "") : "";
  const base = (dot > 0 ? fileName.slice(0, dot) : fileName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${now.getUTCFullYear()}/${month}/${id}${base ? `-${base}` : ""}${ext ? `.${ext}` : ""}`;
}

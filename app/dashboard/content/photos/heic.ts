/**
 * HEIC → JPEG in the browser. Only Safari can show HEIC, and LinkedIn won't take it, so the library
 * stores JPEGs. heic-to (libheif in WebAssembly, ~2 MB) loads only when a HEIC file turns up.
 */

const HEIC_TYPES = ["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"];

/** By type or name: Chrome and Firefox often give .heic files an empty type. */
export function looksHeic(file: { name?: string | null; type?: string | null }): boolean {
  return HEIC_TYPES.includes((file.type ?? "").toLowerCase()) || /\.(heic|heif)$/i.test(file.name ?? "");
}

export const jpegName = (name: string) => (/\.(heic|heif)$/i.test(name) ? name.replace(/\.(heic|heif)$/i, ".jpg") : `${name}.jpg`);

export async function heicToJpeg(blob: Blob, name: string): Promise<File> {
  const { heicTo } = await import("heic-to");
  const jpeg = await heicTo({ blob, type: "image/jpeg", quality: 0.92 });
  return new File([jpeg], jpegName(name), { type: "image/jpeg", lastModified: blob instanceof File ? blob.lastModified : Date.now() });
}

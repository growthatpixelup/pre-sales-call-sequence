/** Browser side of an upload: HEIC → JPEG, size, and the PUT to a signed Storage URL. */

import { heicToJpeg, looksHeic } from "./heic";

/** The file to store: HEIC becomes JPEG, anything else is left alone. */
export async function storable(file: File): Promise<File> {
  return looksHeic(file) ? heicToJpeg(file, file.name) : file;
}

/** Width and height, when the browser can decode the file. */
export async function dimensions(file: Blob): Promise<{ width: number | null; height: number | null }> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return { width: null, height: null };
  }
}

export async function putToStorage(signedUrl: string, file: File): Promise<void> {
  const res = await fetch(signedUrl, {
    method: "PUT",
    body: file,
    headers: { "content-type": file.type, "x-upsert": "false", "cache-control": "max-age=3600" },
  });
  if (!res.ok) throw new Error(`Storage said ${res.status}`);
}

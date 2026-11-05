/** Thrown by a source reader whose credentials aren't set; pages show "not connected". */
export class NotConnected extends Error {
  readonly missing: string[];
  constructor(missing: string[]) {
    super(`Not configured: ${missing.join(", ")}`);
    this.missing = missing;
  }
}

/** Keeps a reader's result for a few minutes, so page loads don't spend the APIs' rate limits. */
export function cached<T>(ttlMs: number, read: () => Promise<T>): () => Promise<T> {
  let entry: { at: number; value: Promise<T> } | null = null;
  return () => {
    if (entry && Date.now() - entry.at < ttlMs) return entry.value;
    const value = read();
    entry = { at: Date.now(), value };
    // A failure isn't kept: the next load tries again.
    value.catch(() => {
      if (entry?.value === value) entry = null;
    });
    return value;
  };
}

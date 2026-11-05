/** Number and time formatting for Content OS. */

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat("en-US");

/** 12,400 → "12.4K"; small numbers stay exact. */
export const formatCompact = (n: number) => (Math.abs(n) < 10_000 ? whole.format(Math.round(n)) : compact.format(n));

/** 0.0342 → "3.4%". */
export const formatPct = (n: number | null, digits = 1) => (n == null ? "—" : `${(n * 100).toFixed(digits)}%`);

/** 0.12 → "+12%", -0.05 → "−5%". */
export function formatChange(n: number) {
  const pct = Math.round(n * 100);
  return pct === 0 ? "0%" : `${pct > 0 ? "+" : "−"}${Math.abs(pct)}%`;
}

/** "3h ago", "2d ago", "just now". */
export function timeAgo(iso: string, now: number) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${whole.format(n)} ${n === 1 ? one : many}`;

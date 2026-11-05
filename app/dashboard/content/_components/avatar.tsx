"use client";

import { useState } from "react";

/**
 * A person's profile picture, round. Falls back to their initials when there's no picture or it
 * fails to load (LinkedIn image links expire after a while).
 */
export function Avatar({ name, url, size = 36 }: { name: string; url: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  // `!`: globals.css squares every corner (`* { border-radius: 0 }`) outside any layer.
  if (url && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className="shrink-0 rounded-full! bg-panel-2 object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full! bg-panel-2 font-mono text-[0.72rem] text-muted"
      style={{ width: size, height: size }}
    >
      {initials || "?"}
    </span>
  );
}

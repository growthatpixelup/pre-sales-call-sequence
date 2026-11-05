"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * Shows the first few lines of a post with "Show more" when there's more. The button only
 * appears if the text actually overflows.
 */
export function ClampedText({ lines = 7, children }: { lines?: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="mt-4">
      <div
        ref={ref}
        className="overflow-hidden text-[1rem] leading-relaxed whitespace-pre-line text-body"
        style={open ? undefined : { display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: lines }}
      >
        {children}
      </div>
      {(overflows || open) && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="mt-2 cursor-pointer text-[0.9rem] text-link hover:underline"
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

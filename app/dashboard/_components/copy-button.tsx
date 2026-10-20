"use client";

import { useState } from "react";
import { Icon } from "./ui";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <>
      <button
        type="button"
        data-copied={copied}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          } catch {
            // Clipboard blocked (e.g. not https); the text is on screen to copy by hand.
          }
        }}
        className="action action-copy"
      >
        <Icon name="copy" />
        {copied ? "Copied" : "Copy"}
      </button>
      <div className="toast" data-show={copied} role="status" aria-live="polite">
        {copied ? "Copied to clipboard" : ""}
      </div>
    </>
  );
}

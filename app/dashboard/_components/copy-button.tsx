"use client";

import { useState } from "react";
import { Icon } from "./ui";

/** `plain`: a quiet "Copy" button without the icon (Content OS cards). */
export function CopyButton({ text, plain = false }: { text: string; plain?: boolean }) {
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
        className={plain ? "bg-panel-2 px-3 py-1.5 text-[0.9rem] text-body hover:text-text" : "action action-copy"}
      >
        {!plain && <Icon name="copy" />}
        {copied ? "Copied" : "Copy"}
      </button>
      <div className="toast" data-show={copied} role="status" aria-live="polite">
        {copied ? "Copied to clipboard" : ""}
      </div>
    </>
  );
}

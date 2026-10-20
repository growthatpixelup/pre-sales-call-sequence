import Link from "next/link";
import { splitQuoted, type LeadReply } from "@/lib/emails/replies";
import { formatDateTime } from "@/lib/format";
import { markReplyRead } from "../actions";

const BUTTON =
  "rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800";

/**
 * A list of replies. `leadNames` (lead id → name) adds a link to each reply's lead; `preview`
 * shows a two-line snippet instead of the full text.
 */
export function ReplyList({
  replies,
  leadNames,
  preview = false,
}: {
  replies: LeadReply[];
  leadNames?: Map<string, string>;
  preview?: boolean;
}) {
  return (
    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
      {replies.map((reply) => {
        const { body, quoted } = splitQuoted(reply.text);
        const unread = !reply.readAt;
        const leadName = reply.leadId ? leadNames?.get(reply.leadId) : undefined;
        return (
          <li key={reply.id} className="px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {unread && <span className="size-2 shrink-0 rounded-full bg-blue-600" aria-label="Unread" />}
                  <span className={unread ? "font-semibold" : "font-medium"}>
                    {reply.fromName ?? reply.fromEmail}
                  </span>
                  {reply.fromName && <span className="text-zinc-500 dark:text-zinc-400">{reply.fromEmail}</span>}
                  {leadNames &&
                    (reply.leadId ? (
                      <Link
                        href={`/dashboard/leads/${reply.leadId}`}
                        className="text-blue-600 hover:underline dark:text-blue-400"
                      >
                        {leadName ?? "View lead"}
                      </Link>
                    ) : (
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">Not matched to a lead</span>
                    ))}
                </div>
                <p className="mt-0.5 text-sm text-zinc-700 dark:text-zinc-300">{reply.subject || "(no subject)"}</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{formatDateTime(reply.receivedAt)}</p>
              </div>
              {unread && (
                <form action={markReplyRead.bind(null, reply.id)}>
                  <button type="submit" className={BUTTON}>
                    Mark read
                  </button>
                </form>
              )}
            </div>
            {preview ? (
              <p className="mt-2 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400">{body || "(empty)"}</p>
            ) : (
              <>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm">{body || "(empty)"}</p>
                {quoted && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-zinc-500 dark:text-zinc-400">
                      Show quoted text
                    </summary>
                    <p className="mt-1 whitespace-pre-wrap break-words border-l-2 border-zinc-200 pl-3 text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                      {quoted}
                    </p>
                  </details>
                )}
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

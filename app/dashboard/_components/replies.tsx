import Link from "next/link";
import { splitQuoted, type LeadReply } from "@/lib/emails/replies";
import { formatDateTime } from "@/lib/format";
import { markReplyRead } from "../actions";
import { Tag } from "./ui";

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
    <ul className="list">
      {replies.map((reply) => {
        const { body, quoted } = splitQuoted(reply.text);
        const unread = !reply.readAt;
        const leadName = reply.leadId ? leadNames?.get(reply.leadId) : undefined;
        return (
          <li key={reply.id} className={unread ? "item-picked" : undefined}>
            <div className="item">
              <div className="min-w-0">
                <p className="item-title m-0">{reply.subject || "(no subject)"}</p>
                <p className="m-0 mt-1 text-[0.92rem] text-muted">
                  <span className="text-text">{reply.fromName ?? reply.fromEmail}</span>
                  {reply.fromName && <> · {reply.fromEmail}</>}
                  {leadNames &&
                    (reply.leadId ? (
                      <>
                        {" · "}
                        <Link href={`/dashboard/leads/${reply.leadId}`} className="link">
                          {leadName ?? "View lead"}
                        </Link>
                      </>
                    ) : (
                      <> · Not matched to a lead</>
                    ))}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  {unread && <Tag>Unread</Tag>}
                  <span className="mono-label">{formatDateTime(reply.receivedAt)}</span>
                </div>
                {preview ? (
                  <p className="m-0 mt-3 line-clamp-2 text-[0.95rem] text-body">{body || "(empty)"}</p>
                ) : (
                  <>
                    <p className="prose m-0 mt-4 whitespace-pre-wrap break-words">{body || "(empty)"}</p>
                    {quoted && (
                      <details className="mt-3">
                        <summary className="mono-label cursor-pointer hover:text-text">Show quoted text</summary>
                        <p className="m-0 mt-2 max-w-[68ch] whitespace-pre-wrap break-words border-l border-line-2 pl-4 text-[0.85rem] text-muted">
                          {quoted}
                        </p>
                      </details>
                    )}
                  </>
                )}
              </div>
              {unread && (
                <form action={markReplyRead.bind(null, reply.id)} className="item-actions">
                  <button type="submit" className="action">
                    Mark read
                  </button>
                </form>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

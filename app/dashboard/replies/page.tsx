import type { Metadata } from "next";
import { Suspense } from "react";
import { listReplies } from "@/lib/emails/replies";
import { listLeads } from "@/lib/leads/store";
import { markAllRepliesRead } from "../actions";
import { ReplyList } from "../_components/replies";

export const metadata: Metadata = { title: "Replies · Dashboard" };

export default function RepliesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Replies</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Replies to the email sequence, newest first.
        </p>
      </div>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-zinc-200/70 dark:bg-zinc-800" />}>
        <Replies />
      </Suspense>
    </div>
  );
}

async function Replies() {
  const [replies, leads] = await Promise.all([listReplies({ limit: 200 }).catch(() => null), listLeads()]);
  if (!replies) {
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
        Replies couldn&apos;t be loaded. If you haven&apos;t yet, run supabase/migrations/005_pipeline_and_replies.sql
        in the Supabase SQL Editor.
      </p>
    );
  }
  const leadNames = new Map(leads.map((l) => [l.id, l.name]));
  const unread = replies.filter((r) => !r.readAt).length;

  if (!replies.length) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-6 py-16 text-center dark:border-zinc-700 dark:bg-zinc-900">
        <p className="font-medium">No replies yet</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-zinc-500 dark:text-zinc-400">
          Replies show up here once EMAIL_REPLY_TO points at a Resend receiving address and the Resend webhook
          is sending email.received events to /api/webhooks/resend.
        </p>
      </div>
    );
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="text-sm font-semibold">
          {replies.length} {replies.length === 1 ? "reply" : "replies"}
          {unread > 0 && <span className="font-normal text-zinc-500 dark:text-zinc-400"> · {unread} unread</span>}
        </h2>
        {unread > 0 && (
          <form action={markAllRepliesRead}>
            <button
              type="submit"
              className="rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
            >
              Mark all read
            </button>
          </form>
        )}
      </div>
      <ReplyList replies={replies} leadNames={leadNames} />
    </section>
  );
}

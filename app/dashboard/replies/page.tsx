import type { Metadata } from "next";
import { Suspense } from "react";
import { listReplies } from "@/lib/emails/replies";
import { listLeads } from "@/lib/leads/store";
import { markAllRepliesRead } from "../actions";
import { ReplyList } from "../_components/replies";
import { Callout, Page, PageSkeleton, RailActions, RailIntro, Rows, Section } from "../_components/ui";

export const metadata: Metadata = { title: "Replies · Dashboard" };

const TITLE = "Replies";
const SUB = "Replies to the email sequence, newest first.";

export default function RepliesPage() {
  return (
    <Suspense fallback={<PageSkeleton title={TITLE} sub={SUB} label="Loading replies" />}>
      <Replies />
    </Suspense>
  );
}

async function Replies() {
  const [replies, leads] = await Promise.all([listReplies({ limit: 200 }).catch(() => null), listLeads()]);
  if (!replies) {
    return (
      <Page rail={<RailIntro title={TITLE} sub={SUB} />}>
        <div className="pt-7">
          <Callout title="Replies couldn’t be loaded.">
            If you haven&apos;t yet, run supabase/migrations/005_pipeline_and_replies.sql in the Supabase SQL Editor.
          </Callout>
        </div>
      </Page>
    );
  }
  const leadNames = new Map(leads.map((l) => [l.id, l.name]));
  const unread = replies.filter((r) => !r.readAt).length;

  return (
    <Page
      rail={
        <>
          <RailIntro title={TITLE} sub={SUB} />
          <Rows
            rows={[
              ["Total", <span key="total" className="tabular-nums">{replies.length}</span>],
              ["Unread", <span key="unread" className="tabular-nums">{unread}</span>],
            ]}
          />
          {unread > 0 && (
            <RailActions>
              <form action={markAllRepliesRead}>
                <button type="submit" className="btn">
                  Mark all read
                </button>
              </form>
            </RailActions>
          )}
        </>
      }
    >
      {replies.length ? (
        <Section wide label={`${replies.length} ${replies.length === 1 ? "reply" : "replies"}`}>
          <ReplyList replies={replies} leadNames={leadNames} />
        </Section>
      ) : (
        <div className="pt-7">
          <Callout title="No replies yet.">
            Replies show up here once EMAIL_REPLY_TO points at a Resend receiving address and the Resend webhook is
            sending email.received events to /api/webhooks/resend.
          </Callout>
        </div>
      )}
    </Page>
  );
}

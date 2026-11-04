import { connection } from "next/server";
import { Suspense } from "react";
import { unreadReplyCount } from "@/lib/emails/replies";
import { loadTasks } from "@/lib/tasks";
import { NavLink } from "@/app/dashboard/_components/nav-link";

/** Booked calls (Cal.com): bookings, the pre-call email sequence and replies. */
export default function CallsLayout({ children }: LayoutProps<"/dashboard/calls">) {
  return (
    <>
      <nav className="sub-nav" aria-label="Booked calls">
        <NavLink href="/dashboard/calls" exact>
          Overview
        </NavLink>
        <NavLink href="/dashboard/calls/bookings">Bookings</NavLink>
        <NavLink href="/dashboard/calls/tasks">
          Tasks
          <Suspense fallback={null}>
            <TaskCount />
          </Suspense>
        </NavLink>
        <NavLink href="/dashboard/calls/emails">Emails</NavLink>
        <NavLink href="/dashboard/calls/replies">
          Replies
          <Suspense fallback={null}>
            <UnreadCount />
          </Suspense>
        </NavLink>
      </nav>
      {children}
    </>
  );
}

async function UnreadCount() {
  // The nav shouldn't break the page if replies aren't set up yet (migration not run).
  const count = await unreadReplyCount().catch(() => 0);
  return <Badge count={count} label="unread" />;
}

async function TaskCount() {
  // Which tasks are due depends on the current time.
  await connection();
  const count = await loadTasks(new Date())
    .then(({ tasks }) => tasks.length)
    .catch(() => 0);
  return <Badge count={count} label="to do" />;
}

function Badge({ count, label }: { count: number; label: string }) {
  if (!count) return null;
  return (
    <span className="bg-blue px-1.5 py-px font-mono text-[0.72rem] tabular-nums text-text">
      <span className="sr-only">, {label}: </span>
      {count}
    </span>
  );
}

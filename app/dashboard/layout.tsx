import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { unreadReplyCount } from "@/lib/emails/replies";
import { loadTasks } from "@/lib/tasks";
import { NavLink } from "./_components/nav-link";

export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="site-header">
        <Link href="/dashboard" className="flex items-baseline gap-3 text-text no-underline">
          <span className="font-display text-lg font-medium tracking-[-0.02em]">Pixelup Labs</span>
          <span className="mono-label">Call leads</span>
        </Link>
        <nav className="site-nav" aria-label="Dashboard">
          <NavLink href="/dashboard" exact>
            Overview
          </NavLink>
          <NavLink href="/dashboard/leads">Leads</NavLink>
          <NavLink href="/dashboard/tasks">
            Tasks
            <Suspense fallback={null}>
              <TaskCount />
            </Suspense>
          </NavLink>
          <NavLink href="/dashboard/emails">Emails</NavLink>
          <NavLink href="/dashboard/replies">
            Replies
            <Suspense fallback={null}>
              <UnreadCount />
            </Suspense>
          </NavLink>
        </nav>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}

async function UnreadCount() {
  // The header shouldn't break the page if replies aren't set up yet (migration not run).
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

import Link from "next/link";
import { Suspense } from "react";
import { unreadReplyCount } from "@/lib/emails/replies";
import { NavLink } from "./_components/nav-link";

export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex h-14 max-w-screen-2xl items-center gap-6 px-4 sm:px-6">
          <Link href="/dashboard" className="text-sm font-semibold tracking-tight">
            Call Leads
          </Link>
          <nav className="flex items-center gap-1 text-sm" aria-label="Dashboard">
            <NavLink href="/dashboard" exact>
              Overview
            </NavLink>
            <NavLink href="/dashboard/leads">Leads</NavLink>
            <NavLink href="/dashboard/replies">
              Replies
              <Suspense fallback={null}>
                <UnreadCount />
              </Suspense>
            </NavLink>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-screen-2xl flex-1 px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}

async function UnreadCount() {
  // The header shouldn't break the page if replies aren't set up yet (migration not run).
  const count = await unreadReplyCount().catch(() => 0);
  if (!count) return null;
  return (
    <span className="ml-1.5 rounded-full bg-blue-600 px-1.5 py-0.5 text-xs font-medium tabular-nums text-white">
      <span className="sr-only">, unread: </span>
      {count}
    </span>
  );
}

import Link from "next/link";
import { NavLink } from "./_components/nav-link";

/** GTM OS shell. Channel dashboards (Booked calls, ...) add their own sub-navigation. */
export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="site-header">
        <Link href="/dashboard/pipeline" className="flex items-baseline gap-3 text-text no-underline">
          <span className="font-display text-lg font-medium tracking-[-0.02em]">Pixelup Labs</span>
          <span className="mono-label">GTM OS</span>
        </Link>
        <nav className="site-nav" aria-label="Dashboard">
          <NavLink href="/dashboard/pipeline">Pipeline</NavLink>
          <NavLink href="/dashboard/calls">Booked calls</NavLink>
          <NavLink href="/dashboard/kam">KAM</NavLink>
          <NavLink href="/dashboard/x-leads">X leads</NavLink>
          <NavLink href="/dashboard/content">Content</NavLink>
          <Link href="/dashboard/leads/new" className="action">
            + Add lead
          </Link>
        </nav>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}

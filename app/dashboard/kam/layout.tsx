import { Suspense } from "react";
import { listUnmatched } from "@/lib/kam/store";
import { NavLink } from "@/app/dashboard/_components/nav-link";

/** KAM: accounts, stakeholders and the team's daily touches, fed from #account-based-marketing. */
export default function KamLayout({ children }: LayoutProps<"/dashboard/kam">) {
  return (
    <>
      <nav className="sub-nav" aria-label="KAM">
        <NavLink href="/dashboard/kam" exact>
          Team
        </NavLink>
        <NavLink href="/dashboard/kam/accounts">Accounts</NavLink>
        <NavLink href="/dashboard/kam/review">
          Review
          <Suspense fallback={null}>
            <ReviewCount />
          </Suspense>
        </NavLink>
        <NavLink href="/dashboard/kam/wins">KAM wins</NavLink>
      </nav>
      {children}
    </>
  );
}

async function ReviewCount() {
  // The nav shouldn't break the page before migration 011 has run.
  const count = await listUnmatched()
    .then((list) => list.length)
    .catch(() => 0);
  if (!count) return null;
  return (
    <span className="bg-blue px-1.5 py-px font-mono text-[0.72rem] tabular-nums text-text">
      <span className="sr-only">, to review: </span>
      {count}
    </span>
  );
}

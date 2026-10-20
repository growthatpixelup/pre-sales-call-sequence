"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, type ReactNode } from "react";

type Props = { href: string; exact?: boolean; children: ReactNode };

/** A header link, highlighted on its own pages. The pathname is only known at request time, so
 * the link renders unhighlighted until it streams in. */
export function NavLink(props: Props) {
  return (
    <Suspense fallback={<NavLinkView {...props} active={false} />}>
      <ActiveNavLink {...props} />
    </Suspense>
  );
}

function ActiveNavLink(props: Props) {
  const pathname = usePathname();
  const { href, exact = false } = props;
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return <NavLinkView {...props} active={active} />;
}

function NavLinkView({ href, children, active }: Props & { active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center rounded-md px-3 py-1.5 font-medium ${
        active
          ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
          : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      }`}
    >
      {children}
    </Link>
  );
}

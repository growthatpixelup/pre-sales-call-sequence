import Link from "next/link";

export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex h-14 max-w-screen-2xl items-center px-4 sm:px-6">
          <Link href="/dashboard" className="text-sm font-semibold tracking-tight">
            Call Leads
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-screen-2xl flex-1 px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}

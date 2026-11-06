import { NavLink } from "@/app/dashboard/_components/nav-link";

/**
 * Content OS: the creator's X and LinkedIn analytics, posting calendar, swipe file and photo library.
 * `.content-os` switches these pages to light mode when the system asks for it (globals.css).
 */
export default function ContentLayout({ children }: LayoutProps<"/dashboard/content">) {
  return (
    <div className="content-os flex flex-1 flex-col">
      <nav className="sub-nav" aria-label="Content">
        <NavLink href="/dashboard/content/analytics">Analytics</NavLink>
        <NavLink href="/dashboard/content/calendar">Calendar</NavLink>
        <NavLink href="/dashboard/content/swipe">Swipe</NavLink>
        <NavLink href="/dashboard/content/photos">Photos</NavLink>
      </nav>
      {children}
    </div>
  );
}

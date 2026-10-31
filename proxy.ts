import { NextResponse, type NextRequest } from "next/server";

/**
 * Basic-auth gate for the dashboard. Set DASHBOARD_PASSWORD to turn it on, and DASHBOARD_USERNAME
 * to require a username too (otherwise any username works).
 * Only /dashboard is matched. /api/webhooks/* and /api/cron/* stay public on purpose: their
 * callers (Cal.com, Resend, Typefully, Supabase cron) have no session, and each route checks its
 * own signature or CRON_SECRET.
 */
export function proxy(request: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return NextResponse.next();
  const username = process.env.DASHBOARD_USERNAME;

  const header = request.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    const decoded = atob(header.slice(6));
    const split = decoded.indexOf(":");
    const user = decoded.slice(0, split);
    const supplied = decoded.slice(split + 1);
    if (supplied === password && (!username || user === username)) return NextResponse.next();
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Dashboard"' },
  });
}

export const config = {
  matcher: ["/dashboard/:path*"],
};

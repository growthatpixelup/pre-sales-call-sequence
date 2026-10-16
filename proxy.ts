import { NextResponse, type NextRequest } from "next/server";

/**
 * Basic-auth gate for the dashboard. Set DASHBOARD_PASSWORD to turn it on (any username works).
 * The Cal.com webhook lives under /api and is not affected; it is protected by its signature.
 */
export function proxy(request: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return NextResponse.next();

  const header = request.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    const decoded = atob(header.slice(6));
    const supplied = decoded.slice(decoded.indexOf(":") + 1);
    if (supplied === password) return NextResponse.next();
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Dashboard"' },
  });
}

export const config = {
  matcher: ["/dashboard/:path*"],
};

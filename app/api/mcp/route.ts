import { timingSafeEqual } from "node:crypto";
import { handleRpc, type McpData } from "@/lib/content/mcp";
import { loadAnalytics, loadSwipes } from "@/lib/content/sources";

/**
 * Content OS MCP server (read-only): swipe-file outliers, hook patterns and Daksh's own best posts.
 * Streamable HTTP, stateless, JSON responses. Lives outside /dashboard so the basic-auth proxy
 * doesn't apply; it checks CONTENT_MCP_TOKEN itself, as `Authorization: Bearer <token>` or
 * `?token=<token>` (claude.ai custom connectors can't send headers). Setup: docs/content-os.md.
 */

const data: McpData = { swipes: loadSwipes, analytics: loadAnalytics };

function authorized(request: Request, token: string): boolean {
  const header = request.headers.get("authorization");
  const supplied = header?.startsWith("Bearer ") ? header.slice(7) : new URL(request.url).searchParams.get("token");
  if (!supplied) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

const rpcError = (status: number, code: number, message: string) =>
  Response.json({ jsonrpc: "2.0", id: null, error: { code, message } }, { status });

export async function POST(request: Request) {
  const token = process.env.CONTENT_MCP_TOKEN?.trim();
  if (!token) return rpcError(503, -32000, "CONTENT_MCP_TOKEN is not configured");
  if (!authorized(request, token)) return rpcError(401, -32001, "Unauthorized");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return rpcError(400, -32700, "Parse error");
  }

  const messages = Array.isArray(body) ? body : [body];
  const replies = (await Promise.all(messages.map((m) => handleRpc(m && typeof m === "object" ? m : {}, data)))).filter(Boolean);
  if (!replies.length) return new Response(null, { status: 202 });
  return Response.json(Array.isArray(body) ? replies : replies[0]);
}

/** No server-initiated stream: this server only answers requests. */
export function GET() {
  return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}

/** No sessions to end. */
export function DELETE() {
  return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}

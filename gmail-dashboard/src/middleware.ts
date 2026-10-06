import { NextResponse, type NextRequest } from "next/server";

/**
 * Local-only hardening:
 * - Host allowlist blocks DNS-rebinding attacks from malicious websites.
 * - State-changing API calls must come from this app's own origin (CSRF).
 */
const ALLOWED_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function hostnameOf(host: string): string {
  if (host.startsWith("[")) return host.slice(0, host.indexOf("]") + 1);
  return host.split(":")[0];
}

export function middleware(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  if (!ALLOWED_HOSTNAMES.has(hostnameOf(host).toLowerCase())) {
    return new NextResponse("Forbidden host", { status: 403 });
  }

  if (req.nextUrl.pathname.startsWith("/api/") && UNSAFE_METHODS.has(req.method)) {
    const origin = req.headers.get("origin");
    let ok = false;
    try {
      ok = origin !== null && new URL(origin).host === host;
    } catch {
      ok = false;
    }
    if (!ok) return NextResponse.json({ error: "Cross-origin request blocked" }, { status: 403 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

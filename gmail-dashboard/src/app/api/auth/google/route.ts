import { NextResponse, type NextRequest } from "next/server";
import { encrypt, randomToken } from "@/lib/crypto";
import { ConfigError, getAppOrigin } from "@/lib/env";
import { buildAuthorizationUrl } from "@/lib/google/oauth";
import type { AccessMode } from "@/lib/google/scopes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OAUTH_TX_COOKIE = "gid_oauth_tx";

/**
 * Starts Google OAuth. ?mode=readonly (default) or ?mode=modify (only when the
 * user explicitly enables cleanup in Settings).
 */
export async function GET(req: NextRequest) {
  let appOrigin: string;
  try {
    appOrigin = getAppOrigin();
  } catch (e) {
    if (e instanceof ConfigError) {
      return NextResponse.redirect(new URL("/settings?auth_error=not_configured", req.nextUrl.origin));
    }
    throw e;
  }

  // The state cookie must be set on the same origin as the redirect URI.
  if (req.nextUrl.origin !== appOrigin) {
    return NextResponse.redirect(new URL(req.nextUrl.pathname + req.nextUrl.search, appOrigin));
  }

  const mode: AccessMode = req.nextUrl.searchParams.get("mode") === "modify" ? "modify" : "readonly";
  const state = randomToken();
  const { url, codeVerifier } = await buildAuthorizationUrl(mode, state);

  const res = NextResponse.redirect(url);
  res.cookies.set(OAUTH_TX_COOKIE, encrypt(JSON.stringify({ state, codeVerifier, mode, at: Date.now() })), {
    httpOnly: true,
    sameSite: "lax", // must survive the top-level redirect back from Google
    secure: appOrigin.startsWith("https://"),
    path: "/api/auth/google",
    maxAge: 600,
  });
  return res;
}

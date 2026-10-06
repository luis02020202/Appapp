import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { decrypt, encrypt, safeEqual } from "@/lib/crypto";
import { errorMessage } from "@/lib/errors";
import { getAppOrigin } from "@/lib/env";
import { fetchProfileWithToken } from "@/lib/gmail/client";
import { exchangeCode, revokeToken } from "@/lib/google/oauth";
import { canRead, parseScopes } from "@/lib/google/scopes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OAUTH_TX_COOKIE = "gid_oauth_tx";

type OAuthTx = { state: string; codeVerifier: string; mode: "readonly" | "modify"; at: number };

function finish(path: string, params: Record<string, string>) {
  const url = new URL(path, getAppOrigin());
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = NextResponse.redirect(url);
  res.cookies.set(OAUTH_TX_COOKIE, "", { path: "/api/auth/google", maxAge: 0 });
  return res;
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;

  // User pressed "Cancel" or Google reported an error.
  const oauthError = params.get("error");
  if (oauthError) return finish("/settings", { auth_error: oauthError });

  // CSRF protection: state must match the encrypted, httpOnly transaction cookie.
  let tx: OAuthTx;
  try {
    const raw = req.cookies.get(OAUTH_TX_COOKIE)?.value;
    if (!raw) throw new Error("missing");
    tx = JSON.parse(decrypt(raw)) as OAuthTx;
  } catch {
    return finish("/settings", { auth_error: "state_missing" });
  }
  const state = params.get("state") ?? "";
  if (!state || !safeEqual(state, tx.state) || Date.now() - tx.at > 10 * 60_000) {
    return finish("/settings", { auth_error: "state_mismatch" });
  }

  const code = params.get("code");
  if (!code) return finish("/settings", { auth_error: "missing_code" });

  try {
    const tokens = await exchangeCode(code, tx.codeVerifier);
    if (!tokens.access_token) throw new Error("Google returned no access token");

    // Google's granular consent lets users untick scopes; verify what we got.
    const granted = parseScopes(tokens.scope);
    if (!canRead(granted)) {
      await revokeToken(tokens.access_token);
      return finish("/settings", { auth_error: "scope_denied" });
    }

    const profile = await fetchProfileWithToken(tokens.access_token);
    const email = profile.emailAddress.toLowerCase();

    const existing = await prisma.account.findFirst({ orderBy: { createdAt: "asc" } });
    if (existing && existing.email !== email) {
      // Single-account app: never mix two mailboxes in one local database.
      await revokeToken(tokens.refresh_token ?? tokens.access_token);
      return finish("/settings", { auth_error: "different_account", expected: existing.email });
    }

    if (!tokens.refresh_token && !existing?.refreshTokenEnc) {
      return finish("/settings", { auth_error: "no_refresh_token" });
    }

    const tokenData = {
      accessTokenEnc: encrypt(tokens.access_token),
      accessTokenExpiresAt: new Date(tokens.expiry_date ?? Date.now() + 50 * 60_000),
      ...(tokens.refresh_token ? { refreshTokenEnc: encrypt(tokens.refresh_token) } : {}),
      scopes: granted.join(" "),
      needsReauth: false,
      authError: null,
    };

    await prisma.account.upsert({
      where: { email },
      create: { email, ...tokenData },
      update: tokenData,
    });

    return finish(tx.mode === "modify" ? "/settings" : "/dashboard", { connected: tx.mode });
  } catch (e) {
    console.error("[oauth] callback failed:", e);
    return finish("/settings", { auth_error: "exchange_failed", detail: errorMessage(e).slice(0, 200) });
  }
}

import "server-only";
import { CodeChallengeMethod, OAuth2Client } from "google-auth-library";
import { getEnv } from "../env";
import { scopesFor, type AccessMode } from "./scopes";

export function createOAuthClient(): OAuth2Client {
  const env = getEnv();
  return new OAuth2Client({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_REDIRECT_URI,
  });
}

export async function buildAuthorizationUrl(mode: AccessMode, state: string) {
  const client = createOAuthClient();
  // PKCE (S256) on top of the client secret, as recommended for OAuth 2.0.
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
  const url = client.generateAuthUrl({
    access_type: "offline", // we need a refresh token for background sync
    prompt: "consent", // guarantees a refresh token is returned
    include_granted_scopes: true, // incremental authorization
    scope: scopesFor(mode),
    state,
    code_challenge_method: CodeChallengeMethod.S256,
    code_challenge: codeChallenge,
  });
  return { url, codeVerifier };
}

export async function exchangeCode(code: string, codeVerifier: string) {
  const client = createOAuthClient();
  const { tokens } = await client.getToken({ code, codeVerifier });
  return tokens;
}

/** Best-effort token revocation at Google. */
export async function revokeToken(token: string): Promise<boolean> {
  try {
    const res = await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function isInvalidGrant(e: unknown): boolean {
  const err = e as { response?: { data?: { error?: string } }; message?: string } | null;
  return err?.response?.data?.error === "invalid_grant" || /invalid_grant/i.test(err?.message ?? "");
}

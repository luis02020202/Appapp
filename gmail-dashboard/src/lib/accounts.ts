import "server-only";
import { prisma } from "./db";
import { decrypt, encrypt } from "./crypto";
import { AuthRequiredError } from "./errors";
import { createOAuthClient, isInvalidGrant } from "./google/oauth";
import { canModify, canRead, parseScopes } from "./google/scopes";

/** The app is single-user: the first (only) account is the active one. */
export async function getActiveAccount() {
  return prisma.account.findFirst({ orderBy: { createdAt: "asc" } });
}

export type AccountSummary = {
  id: string;
  email: string;
  scopes: string[];
  connected: boolean;
  canRead: boolean;
  canModify: boolean;
  needsReauth: boolean;
  authError: string | null;
  lastSyncAt: string | null;
  initialSyncCompletedAt: string | null;
  gmailMessagesTotal: number | null;
};

export async function getAccountSummary(): Promise<AccountSummary | null> {
  const a = await getActiveAccount();
  if (!a) return null;
  const scopes = parseScopes(a.scopes);
  return {
    id: a.id,
    email: a.email,
    scopes,
    connected: Boolean(a.refreshTokenEnc) && !a.needsReauth,
    canRead: canRead(scopes),
    canModify: canModify(scopes),
    needsReauth: a.needsReauth,
    authError: a.authError,
    lastSyncAt: a.lastSyncAt?.toISOString() ?? null,
    initialSyncCompletedAt: a.initialSyncCompletedAt?.toISOString() ?? null,
    gmailMessagesTotal: a.gmailMessagesTotal,
  };
}

export async function markNeedsReauth(accountId: string, reason: string) {
  await prisma.account.update({
    where: { id: accountId },
    data: { needsReauth: true, authError: reason, accessTokenEnc: null, accessTokenExpiresAt: null },
  });
}

const refreshes = new Map<string, Promise<{ token: string; expiresAt: number }>>();

/**
 * Returns a valid access token, refreshing it with the stored refresh token if
 * needed. Concurrent callers share one refresh request.
 */
export async function getAccessToken(
  accountId: string,
  opts: { forceRefresh?: boolean } = {},
): Promise<{ token: string; expiresAt: number }> {
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) throw new AuthRequiredError("No Google account connected.");
  if (account.needsReauth || !account.refreshTokenEnc) {
    throw new AuthRequiredError(account.authError ?? undefined);
  }

  const expiresAt = account.accessTokenExpiresAt?.getTime() ?? 0;
  if (!opts.forceRefresh && account.accessTokenEnc && expiresAt - 60_000 > Date.now()) {
    return { token: decrypt(account.accessTokenEnc), expiresAt };
  }

  let pending = refreshes.get(accountId);
  if (!pending) {
    pending = refreshAccessToken(accountId, decrypt(account.refreshTokenEnc)).finally(() =>
      refreshes.delete(accountId),
    );
    refreshes.set(accountId, pending);
  }
  return pending;
}

async function refreshAccessToken(accountId: string, refreshToken: string) {
  const client = createOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });
  try {
    const { token } = await client.getAccessToken();
    if (!token) throw new Error("Google returned no access token");
    const creds = client.credentials;
    const expiresAt = creds.expiry_date ?? Date.now() + 50 * 60_000;
    await prisma.account.update({
      where: { id: accountId },
      data: {
        accessTokenEnc: encrypt(token),
        accessTokenExpiresAt: new Date(expiresAt),
        // Google may rotate refresh tokens; keep the newest one.
        ...(creds.refresh_token && creds.refresh_token !== refreshToken
          ? { refreshTokenEnc: encrypt(creds.refresh_token) }
          : {}),
      },
    });
    return { token, expiresAt };
  } catch (e) {
    if (isInvalidGrant(e)) {
      const reason =
        "Google rejected the stored refresh token (revoked, expired, or the app is in Testing mode where tokens expire after 7 days). Please reconnect.";
      await markNeedsReauth(accountId, reason);
      throw new AuthRequiredError(reason);
    }
    throw e;
  }
}

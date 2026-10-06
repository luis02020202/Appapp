import { NextResponse } from "next/server";
import { getActiveAccount } from "@/lib/accounts";
import { decrypt } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { revokeToken } from "@/lib/google/oauth";
import { isSyncRunning, requestCancel } from "@/lib/sync/engine";

export const runtime = "nodejs";

/**
 * Revokes Google access and deletes stored tokens. Local analysis data is kept
 * (use "Delete local data" to remove it).
 */
export async function POST() {
  const account = await getActiveAccount();
  if (!account) return NextResponse.json({ ok: true });
  if (isSyncRunning()) requestCancel();

  let revoked = false;
  const token = account.refreshTokenEnc ?? account.accessTokenEnc;
  if (token) {
    try {
      revoked = await revokeToken(decrypt(token));
    } catch {
      revoked = false;
    }
  }

  await prisma.account.update({
    where: { id: account.id },
    data: {
      accessTokenEnc: null,
      refreshTokenEnc: null,
      accessTokenExpiresAt: null,
      scopes: "",
      needsReauth: false,
      authError: null,
    },
  });
  return NextResponse.json({ ok: true, revoked });
}

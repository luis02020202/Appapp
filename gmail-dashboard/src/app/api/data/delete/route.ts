import { NextResponse, type NextRequest } from "next/server";
import { getActiveAccount } from "@/lib/accounts";
import { decrypt } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { revokeToken } from "@/lib/google/oauth";
import { isSyncRunning } from "@/lib/sync/engine";

export const runtime = "nodejs";

/** Deletes ALL local data (never touches Gmail). Requires {"confirm":"DELETE"}. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { confirm?: string } | null;
  if (body?.confirm !== "DELETE") {
    return NextResponse.json({ error: 'Confirmation text "DELETE" required.' }, { status: 400 });
  }
  if (isSyncRunning()) {
    return NextResponse.json({ error: "Cancel the running synchronization first." }, { status: 409 });
  }

  const account = await getActiveAccount();
  const token = account?.refreshTokenEnc ?? account?.accessTokenEnc;
  if (token) {
    try {
      await revokeToken(decrypt(token));
    } catch {
      // ignore: data deletion must not depend on Google being reachable
    }
  }

  // Cascades remove messages, labels, sync runs and errors.
  await prisma.account.deleteMany({});
  return NextResponse.json({ ok: true });
}

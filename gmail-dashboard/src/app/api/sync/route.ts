import { NextResponse, type NextRequest } from "next/server";
import { getActiveAccount } from "@/lib/accounts";
import { AuthRequiredError, errorMessage } from "@/lib/errors";
import { startSync } from "@/lib/sync/engine";

export const runtime = "nodejs";

/** Starts a background sync. Body: {"mode":"auto"|"full"} (default auto). */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { mode?: string };
  const mode = body.mode === "full" ? "full" : "auto";

  const account = await getActiveAccount();
  if (!account || !account.refreshTokenEnc) {
    return NextResponse.json({ error: "Connect a Google account first." }, { status: 400 });
  }

  try {
    const result = await startSync(account.id, mode);
    return NextResponse.json(result, { status: result.alreadyRunning ? 200 : 202 });
  } catch (e) {
    const status = e instanceof AuthRequiredError ? 401 : 409;
    return NextResponse.json({ error: errorMessage(e) }, { status });
  }
}

import { NextResponse } from "next/server";
import { getSyncStatus } from "@/lib/sync/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getSyncStatus(), { headers: { "Cache-Control": "no-store" } });
}

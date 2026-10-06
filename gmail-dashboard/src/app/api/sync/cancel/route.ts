import { NextResponse } from "next/server";
import { requestCancel } from "@/lib/sync/engine";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json({ cancelled: requestCancel() });
}

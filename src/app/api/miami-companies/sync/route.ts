export const runtime    = "nodejs";
export const maxDuration = 300; // 5 min — detail calls take time

import { NextResponse } from "next/server";
import { syncMiamiCompanies } from "@/lib/syncMiamiCompanies";

/** POST /api/miami-companies/sync */
export async function POST() {
  try {
    const stats = await syncMiamiCompanies();
    return NextResponse.json({ success: true, stats });
  } catch (err) {
    console.error("[POST /api/miami-companies/sync]", err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

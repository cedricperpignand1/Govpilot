export const runtime   = "nodejs";
export const maxDuration = 300; // 5 min — sync is intentionally slow to respect Hunter quotas

import { NextResponse } from "next/server";
import { syncMiamiContractorEmails } from "@/lib/syncMiamiContractorEmails";

/**
 * POST /api/miami-contractor-emails/sync
 *
 * Triggers Hunter enrichment for all Miami contractors that have a domain.
 * Returns: { success, stats }
 */
export async function POST() {
  try {
    const stats = await syncMiamiContractorEmails();
    return NextResponse.json({ success: true, stats });
  } catch (err) {
    console.error("[POST /api/miami-contractor-emails/sync]", err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

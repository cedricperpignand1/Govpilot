export const runtime = "nodejs";
export const maxDuration = 300; // 5 min — sync can take a while

import { NextRequest, NextResponse } from "next/server";
import { syncMiamiContractors } from "@/lib/syncMiamiContractors";

/**
 * POST /api/miami-contractors/sync
 *
 * Triggers a full sync of Miami construction contractors from SAM.gov.
 * Optionally accepts { city, state } in the JSON body to override defaults.
 *
 * Returns: { success, stats: { totalFetched, inserted, updated, failed, errors } }
 */
export async function POST(req: NextRequest) {
  const SAM_KEY = process.env.SAM_API_KEY ?? "";
  if (!SAM_KEY || SAM_KEY === "PASTE_YOUR_SAM_GOV_API_KEY_HERE") {
    return NextResponse.json(
      { error: "SAM_API_KEY is not configured. Add it to .env.local." },
      { status: 500 }
    );
  }

  let city: string | undefined;
  let state: string | undefined;

  try {
    const body = await req.json().catch(() => ({}));
    city  = body.city  ?? undefined;
    state = body.state ?? undefined;
  } catch { /* no body — use defaults */ }

  try {
    const stats = await syncMiamiContractors(city, state);
    return NextResponse.json({ success: true, stats });
  } catch (err) {
    console.error("[POST /api/miami-contractors/sync]", err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

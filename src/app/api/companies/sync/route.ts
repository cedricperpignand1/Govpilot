export const runtime     = "nodejs";
export const maxDuration = 300; // 5 min

import { NextRequest, NextResponse } from "next/server";
import { syncCompanies } from "@/lib/syncCompanies";

/**
 * POST /api/companies/sync
 *
 * Body:
 *   keyword        string   — required, e.g. "architects"
 *   location       string   — required, e.g. "New York" or "FL"
 *   extraKeywords  string[] — optional additional search variants
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      keyword?: string;
      location?: string;
      extraKeywords?: string[];
    };

    const keyword  = (body.keyword  ?? "").trim();
    const location = (body.location ?? "").trim();

    if (!keyword || !location) {
      return NextResponse.json(
        { success: false, error: "keyword and location are required" },
        { status: 400 }
      );
    }

    const stats = await syncCompanies(keyword, location, body.extraKeywords ?? []);
    return NextResponse.json({ success: true, stats });

  } catch (err) {
    console.error("[POST /api/companies/sync]", err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { generateContractorsCsv, exportFilename } from "@/lib/exportContractorsCsv";

/**
 * GET /api/miami-contractors/export
 *
 * Accepts the same filter query params as GET /api/miami-contractors
 * (city, state, name, naics, status) and returns a downloadable CSV.
 */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;

    const filters = {
      city:   sp.get("city")   ?? undefined,
      state:  sp.get("state")  ?? undefined,
      name:   sp.get("name")   ?? undefined,
      naics:  sp.get("naics")  ?? undefined,
      status: sp.get("status") ?? undefined,
    };

    const csv = generateContractorsCsv(filters);
    const filename = exportFilename();

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[GET /api/miami-contractors/export]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

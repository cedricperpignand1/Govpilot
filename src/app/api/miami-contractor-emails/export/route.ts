export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { generateEmailsCsv, emailExportFilename } from "@/lib/exportMiamiContractorEmailsCsv";

/**
 * GET /api/miami-contractor-emails/export
 *
 * Accepts the same filter params as the main GET endpoint.
 * Suppressed records and non-exportable records are always excluded.
 * Returns a downloadable CSV file.
 */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;

    const filters = {
      companyName:        sp.get("companyName")        ?? undefined,
      domain:             sp.get("domain")             ?? undefined,
      email:              sp.get("email")              ?? undefined,
      verificationStatus: sp.get("verificationStatus") ?? undefined,
      minConfidence:      sp.has("minConfidence") ? Number(sp.get("minConfidence")) : undefined,
      source:             sp.get("source")             ?? undefined,
      department:         sp.get("department")         ?? undefined,
    };

    const csv      = generateEmailsCsv(filters);
    const filename = emailExportFilename();

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type":        "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control":       "no-store",
      },
    });
  } catch (err) {
    console.error("[GET /api/miami-contractor-emails/export]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

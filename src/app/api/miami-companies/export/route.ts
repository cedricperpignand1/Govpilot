export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { generateCompaniesCsv, companiesExportFilename } from "@/lib/exportMiamiCompaniesCsv";

/** GET /api/miami-companies/export */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const filters = {
      name:            sp.get("name")        ?? undefined,
      domain:          sp.get("domain")      ?? undefined,
      city:            sp.get("city")        ?? undefined,
      state:           sp.get("state")       ?? undefined,
      crawlStatus:     sp.get("crawlStatus") ?? undefined,
      onlyWithWebsite: sp.get("onlyWithWebsite") === "true",
      onlyWithEmails:  sp.get("onlyWithEmails")  === "true",
    };

    const csv      = generateCompaniesCsv(filters);
    const filename = companiesExportFilename();

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type":        "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control":       "no-store",
      },
    });
  } catch (err) {
    console.error("[GET /api/miami-companies/export]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

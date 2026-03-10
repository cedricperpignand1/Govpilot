export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { listMiamiCompanies, getMiamiCompaniesSummary } from "@/lib/db";

/**
 * GET /api/miami-companies
 * ?summary=true  → returns only summary card stats
 * ?name, domain, city, state, onlyWithWebsite, sortBy, sortDir, page, pageSize
 */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;

    if (sp.get("summary") === "true") {
      return NextResponse.json(getMiamiCompaniesSummary());
    }

    const params = {
      name:            sp.get("name")    ?? undefined,
      domain:          sp.get("domain")  ?? undefined,
      city:            sp.get("city")    ?? undefined,
      state:           sp.get("state")   ?? undefined,
      crawlStatus:     sp.get("crawlStatus") ?? undefined,
      onlyWithWebsite: sp.get("onlyWithWebsite") === "true",
      onlyWithEmails:  sp.get("onlyWithEmails")  === "true",
      minEmailCount:   sp.has("minEmailCount") ? Number(sp.get("minEmailCount")) : undefined,
      sortBy:          sp.get("sortBy")  ?? "companyName",
      sortDir:        (sp.get("sortDir") ?? "asc") as "asc" | "desc",
      page:            Number(sp.get("page")     ?? 1),
      pageSize:        Number(sp.get("pageSize") ?? 50),
    };

    const { rows, total } = listMiamiCompanies(params);
    return NextResponse.json({ rows, total, page: params.page, pageSize: params.pageSize });
  } catch (err) {
    console.error("[GET /api/miami-companies]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { listContractors, getSummaryStats } from "@/lib/db";

/**
 * GET /api/miami-contractors
 *
 * Query params:
 *   city, state, name, naics, status
 *   sortBy, sortDir (asc|desc)
 *   page (default 1), pageSize (default 50)
 *   summary=true → returns only summary stats (no rows)
 */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;

    if (sp.get("summary") === "true") {
      const stats = getSummaryStats();
      return NextResponse.json(stats);
    }

    const params = {
      city:     sp.get("city")     ?? undefined,
      state:    sp.get("state")    ?? undefined,
      name:     sp.get("name")     ?? undefined,
      naics:    sp.get("naics")    ?? undefined,
      status:   sp.get("status")   ?? undefined,
      sortBy:   sp.get("sortBy")   ?? "entityName",
      sortDir: (sp.get("sortDir")  ?? "asc") as "asc" | "desc",
      page:     Number(sp.get("page")     ?? 1),
      pageSize: Number(sp.get("pageSize") ?? 50),
    };

    const { rows, total } = listContractors(params);

    return NextResponse.json({ rows, total, page: params.page, pageSize: params.pageSize });
  } catch (err) {
    console.error("[GET /api/miami-contractors]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

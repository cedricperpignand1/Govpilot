export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { listContractorEmails, getEmailSummaryStats } from "@/lib/db";

/**
 * GET /api/miami-contractor-emails
 *
 * Query params:
 *   summary=true → returns only summary card stats
 *   companyName, domain, email, verificationStatus, minConfidence,
 *   source, department, onlyWithEmails, onlyExportable, hideSuppressed
 *   sortBy, sortDir, page, pageSize
 */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;

    if (sp.get("summary") === "true") {
      return NextResponse.json(getEmailSummaryStats());
    }

    const params = {
      companyName:        sp.get("companyName")        ?? undefined,
      domain:             sp.get("domain")             ?? undefined,
      email:              sp.get("email")              ?? undefined,
      verificationStatus: sp.get("verificationStatus") ?? undefined,
      minConfidence:      sp.has("minConfidence") ? Number(sp.get("minConfidence")) : undefined,
      source:             sp.get("source")             ?? undefined,
      department:         sp.get("department")         ?? undefined,
      onlyWithEmails:     sp.get("onlyWithEmails")  === "true",
      onlyExportable:     sp.get("onlyExportable")  === "true",
      hideSuppressed:     sp.get("hideSuppressed")  !== "false", // default true
      sortBy:             sp.get("sortBy")             ?? "companyName",
      sortDir:           (sp.get("sortDir")            ?? "asc") as "asc" | "desc",
      page:               Number(sp.get("page")     ?? 1),
      pageSize:           Number(sp.get("pageSize") ?? 50),
    };

    const { rows, total } = listContractorEmails(params);
    return NextResponse.json({ rows, total, page: params.page, pageSize: params.pageSize });
  } catch (err) {
    console.error("[GET /api/miami-contractor-emails]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * PATCH /api/miami-contractor-emails
 * Toggle suppressed / exportable on a single record.
 * Body: { id: number, suppressed?: 0|1, exportable?: 0|1, notes?: string }
 */
export async function PATCH(req: NextRequest) {
  try {
    const { id, suppressed, exportable, notes } = await req.json();
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const { db } = await import("@/lib/db");
    const sets: string[] = ["updatedAt = datetime('now')"];
    const vals: (number | string)[] = [];

    if (suppressed !== undefined) { sets.push("suppressed = ?");  vals.push(suppressed); }
    if (exportable !== undefined) { sets.push("exportable = ?");  vals.push(exportable); }
    if (notes      !== undefined) { sets.push("notes = ?");        vals.push(notes); }

    if (sets.length === 1) return NextResponse.json({ ok: true });

    db.prepare(`UPDATE miami_contractor_emails SET ${sets.join(", ")} WHERE id = ?`)
      .run(...vals, id);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

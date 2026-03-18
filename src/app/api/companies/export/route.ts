export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { listScrapedCompanies } from "@/lib/db";

/**
 * GET /api/companies/export
 * Returns a CSV of all matching companies (same filters as list endpoint).
 */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;

    const { rows } = listScrapedCompanies({
      name:            sp.get("name")           ?? undefined,
      domain:          sp.get("domain")         ?? undefined,
      city:            sp.get("city")           ?? undefined,
      state:           sp.get("state")          ?? undefined,
      keyword:         sp.get("keyword")        ?? undefined,
      searchLocation:  sp.get("searchLocation") ?? undefined,
      crawlStatus:     sp.get("crawlStatus")    ?? undefined,
      onlyWithWebsite: sp.get("onlyWithWebsite") === "true",
      onlyWithEmails:  sp.get("onlyWithEmails")  === "true",
      minEmailCount:   sp.has("minEmailCount") ? Number(sp.get("minEmailCount")) : undefined,
      sortBy:  sp.get("sortBy")  ?? "companyName",
      sortDir: (sp.get("sortDir") ?? "asc") as "asc" | "desc",
      page: 1, pageSize: 100_000,
    });

    const headers = [
      "Company Name", "Website", "Domain", "Address", "City", "State",
      "Keyword", "Search Location", "Emails", "Crawl Status", "Last Crawled",
    ];

    const escape = (v: string | null | undefined) => {
      if (v == null) return "";
      const s = String(v).replace(/"/g, '""');
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s}"` : s;
    };

    const lines = [
      headers.join(","),
      ...rows.map((r) => [
        escape(r.companyName),
        escape(r.website),
        escape(r.domain),
        escape(r.address),
        escape(r.city),
        escape(r.state),
        escape(r.keyword),
        escape(r.searchLocation),
        escape(r.emailsList?.replace(/\|\|\|/g, "; ") ?? ""),
        escape(r.crawlStatus),
        escape(r.lastCrawledAt),
      ].join(",")),
    ];

    return new NextResponse(lines.join("\n"), {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="companies-export.csv"`,
      },
    });
  } catch (err) {
    console.error("[GET /api/companies/export]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

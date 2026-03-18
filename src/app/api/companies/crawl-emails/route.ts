export const runtime     = "nodejs";
export const maxDuration = 300; // 5 min

import { NextRequest, NextResponse } from "next/server";
import { crawlCompanyEmails, CrawlOptions } from "@/lib/crawlCompanyEmails";

/**
 * POST /api/companies/crawl-emails
 *
 * Body (all optional):
 *   keyword                string   — only crawl companies with this keyword
 *   searchLocation         string   — only crawl companies with this location
 *   emailLimit             number | null
 *   maxPagesPerSite        number
 *   onlyWithoutEmails      boolean
 *   skipRecentlyCrawledDays number
 */
export async function POST(req: NextRequest) {
  try {
    let body: Partial<CrawlOptions> = {};
    try { body = await req.json(); } catch { /* empty body = all defaults */ }

    const options: Partial<CrawlOptions> = {
      emailLimit:              body.emailLimit ?? null,
      maxPagesPerSite:         typeof body.maxPagesPerSite === "number" ? body.maxPagesPerSite : undefined,
      onlyWithWebsite:         body.onlyWithWebsite ?? undefined,
      onlyWithoutEmails:       body.onlyWithoutEmails ?? undefined,
      skipRecentlyCrawledDays: typeof body.skipRecentlyCrawledDays === "number"
                                 ? body.skipRecentlyCrawledDays : undefined,
      keyword:                 body.keyword        ?? undefined,
      searchLocation:          body.searchLocation ?? undefined,
    };

    const stats = await crawlCompanyEmails(options);
    return NextResponse.json({ success: true, stats });

  } catch (err) {
    console.error("[POST /api/companies/crawl-emails]", err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

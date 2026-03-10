export const runtime    = "nodejs";
export const maxDuration = 300; // 5 min — crawling takes time; increase if needed

import { NextRequest, NextResponse } from "next/server";
import { crawlMiamiCompanyEmails, CrawlOptions } from "@/lib/crawlMiamiCompanyEmails";

/**
 * POST /api/miami-companies/crawl-emails
 *
 * Body (all optional):
 *   emailLimit           number | null   — null = unlimited
 *   maxPagesPerSite      number          — max pages per company (default 6)
 *   onlyWithWebsite      boolean         — skip companies without website
 *   onlyWithoutEmails    boolean         — skip companies that already have emails
 *   skipRecentlyCrawledDays number       — skip if crawled within N days (0 = no skip)
 *
 * Returns:
 *   { success: true, stats: CrawlRunStats }
 *   { success: false, error: string }
 */
export async function POST(req: NextRequest) {
  try {
    let body: Partial<CrawlOptions> = {};
    try {
      body = await req.json();
    } catch {
      // body is optional — empty body means use all defaults
    }

    const options: Partial<CrawlOptions> = {
      emailLimit:               body.emailLimit ?? null,
      maxPagesPerSite:          typeof body.maxPagesPerSite === "number" ? body.maxPagesPerSite : undefined,
      onlyWithWebsite:          body.onlyWithWebsite ?? undefined,
      onlyWithoutEmails:        body.onlyWithoutEmails ?? undefined,
      skipRecentlyCrawledDays:  typeof body.skipRecentlyCrawledDays === "number"
                                  ? body.skipRecentlyCrawledDays
                                  : undefined,
    };

    const stats = await crawlMiamiCompanyEmails(options);
    return NextResponse.json({ success: true, stats });

  } catch (err) {
    console.error("[POST /api/miami-companies/crawl-emails]", err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

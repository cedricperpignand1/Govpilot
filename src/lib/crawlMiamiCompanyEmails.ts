/**
 * Orchestrates email crawling for all Miami companies.
 *
 * Flow:
 *   1. Read companies from miami_companies that are eligible for crawling
 *   2. For each eligible company, run the website crawler
 *   3. Save found emails to miami_company_emails (child table)
 *   4. Update miami_companies aggregate fields (emailCount, crawlStatus, etc.)
 *   5. Respect the global email limit — stop cleanly when reached
 *   6. Return detailed stats
 *
 * Email limit behavior:
 *   - emailLimit = null  → crawl all eligible companies, no cap
 *   - emailLimit = N     → stop after N total NEW emails are collected this run
 *     (counts only newly inserted emails, not pre-existing ones)
 *
 * Concurrency: sequential (one company at a time) for politeness.
 * The inter-company delay in crawlerConfig.ts can be tuned.
 */

import { db } from "./db";
import { crawlCompanyWebsite } from "./emailCrawler";
import {
  CRAWL_INTER_COMPANY_DELAY_MS,
  CRAWL_SKIP_CRAWLED_WITHIN_DAYS,
  CRAWL_MAX_PAGES_PER_COMPANY,
} from "./crawlerConfig";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CrawlOptions {
  emailLimit: number | null;        // null = unlimited
  maxPagesPerSite: number;          // max pages per company
  onlyWithWebsite: boolean;         // skip companies without a website (always true in practice)
  onlyWithoutEmails: boolean;       // skip companies that already have emails saved
  skipRecentlyCrawledDays: number;  // skip if crawled within N days (0 = don't skip)
}

export const DEFAULT_CRAWL_OPTIONS: CrawlOptions = {
  emailLimit: null,
  maxPagesPerSite: CRAWL_MAX_PAGES_PER_COMPANY,
  onlyWithWebsite: true,
  onlyWithoutEmails: false,
  skipRecentlyCrawledDays: CRAWL_SKIP_CRAWLED_WITHIN_DAYS,
};

export interface CrawlRunStats {
  totalCompaniesConsidered: number;
  skippedNoWebsite: number;
  skippedNoChange: number;          // skipped because already has emails + onlyWithoutEmails
  skippedRecentlyCrawled: number;
  totalCompaniesCrawled: number;
  totalPagesCrawled: number;
  totalEmailsFoundThisRun: number;  // new emails inserted (not pre-existing)
  totalDuplicatesSkipped: number;   // emails already in DB that were found again
  totalFailedCompanies: number;
  stoppedByLimit: boolean;
  emailLimit: number | null;
  errors: string[];
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

interface CompanyForCrawl {
  id: number;
  companyName: string | null;
  website: string | null;
  domain: string | null;
  lastCrawledAt: string | null;
  emailCount: number;
}

function loadEligibleCompanies(): CompanyForCrawl[] {
  return db.prepare(`
    SELECT
      mc.id,
      mc.companyName,
      mc.website,
      mc.domain,
      mc.lastCrawledAt,
      COALESCE((SELECT COUNT(*) FROM miami_company_emails WHERE companyId = mc.id), 0) AS emailCount
    FROM miami_companies mc
    WHERE mc.website IS NOT NULL AND mc.website != ''
    ORDER BY mc.lastCrawledAt ASC NULLS FIRST, mc.id ASC
  `).all() as CompanyForCrawl[];
}

const upsertEmail = db.prepare(`
  INSERT INTO miami_company_emails (
    companyId, email, sourceUrl, sourceType, emailRole, createdAt, updatedAt
  ) VALUES (
    @companyId, @email, @sourceUrl, @sourceType, @emailRole,
    datetime('now'), datetime('now')
  )
  ON CONFLICT(companyId, email) DO NOTHING
`);

const updateCompanyCrawl = db.prepare(`
  UPDATE miami_companies SET
    emailCount    = (SELECT COUNT(*) FROM miami_company_emails WHERE companyId = id),
    crawlStatus   = @crawlStatus,
    crawlError    = @crawlError,
    pagesCrawled  = @pagesCrawled,
    lastCrawledAt = @lastCrawledAt,
    hasContactPage = @hasContactPage,
    hasAboutPage   = @hasAboutPage,
    crawlPayload   = @crawlPayload,
    updatedAt      = datetime('now')
  WHERE id = @id
`);

function classifySourceType(url: string): string {
  const lower = url.toLowerCase();
  if (/\/(contact|contact-us|contactus|reach)/.test(lower)) return "contact";
  if (/\/(about|about-us|aboutus)/.test(lower)) return "about";
  if (/\/(team|staff|people)/.test(lower)) return "team";
  if (/\/(services?)/.test(lower)) return "services";
  return "homepage";
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function crawlMiamiCompanyEmails(
  options: Partial<CrawlOptions> = {}
): Promise<CrawlRunStats> {
  const opts: CrawlOptions = { ...DEFAULT_CRAWL_OPTIONS, ...options };

  const stats: CrawlRunStats = {
    totalCompaniesConsidered: 0,
    skippedNoWebsite: 0,
    skippedNoChange: 0,
    skippedRecentlyCrawled: 0,
    totalCompaniesCrawled: 0,
    totalPagesCrawled: 0,
    totalEmailsFoundThisRun: 0,
    totalDuplicatesSkipped: 0,
    totalFailedCompanies: 0,
    stoppedByLimit: false,
    emailLimit: opts.emailLimit,
    errors: [],
  };

  const companies = loadEligibleCompanies();
  stats.totalCompaniesConsidered = companies.length;

  const skipBefore = opts.skipRecentlyCrawledDays > 0
    ? new Date(Date.now() - opts.skipRecentlyCrawledDays * 86_400_000).toISOString()
    : null;

  function sleep(ms: number) {
    return new Promise<void>((r) => setTimeout(r, ms));
  }

  for (const company of companies) {
    // Check email limit BEFORE starting this company
    if (opts.emailLimit !== null && stats.totalEmailsFoundThisRun >= opts.emailLimit) {
      stats.stoppedByLimit = true;
      break;
    }

    // Skip if no website (shouldn't happen given query, but safety check)
    if (!company.website) {
      stats.skippedNoWebsite++;
      continue;
    }

    // Skip if already has emails and onlyWithoutEmails is set
    if (opts.onlyWithoutEmails && company.emailCount > 0) {
      stats.skippedNoChange++;
      continue;
    }

    // Skip if recently crawled
    if (skipBefore && company.lastCrawledAt && company.lastCrawledAt > skipBefore) {
      stats.skippedRecentlyCrawled++;
      continue;
    }

    const domain = company.domain ?? (() => {
      try {
        return new URL(company.website!.startsWith("http") ? company.website! : `https://${company.website}`).hostname.replace(/^www\./, "");
      } catch { return null; }
    })();

    if (!domain) {
      stats.skippedNoWebsite++;
      continue;
    }

    if (stats.totalCompaniesCrawled > 0) {
      await sleep(CRAWL_INTER_COMPANY_DELAY_MS);
    }

    console.log(
      `[crawler] [${stats.totalCompaniesCrawled + 1}] Crawling: ${company.companyName ?? domain} (${domain})`
    );

    let crawlResult;
    try {
      crawlResult = await crawlCompanyWebsite(company.website!, domain, opts.maxPagesPerSite);
    } catch (err) {
      const msg = `${domain}: ${String(err)}`;
      console.error(`[crawler] Unexpected error —`, msg);
      stats.totalFailedCompanies++;
      stats.errors.push(msg);

      // Mark as error in DB
      updateCompanyCrawl.run({
        id: company.id,
        crawlStatus: "error",
        crawlError: String(err),
        pagesCrawled: 0,
        lastCrawledAt: new Date().toISOString(),
        hasContactPage: 0,
        hasAboutPage: 0,
        crawlPayload: null,
      });
      continue;
    }

    stats.totalCompaniesCrawled++;
    stats.totalPagesCrawled += crawlResult.pagesCrawled;

    // Save emails to child table
    let insertedForThisCompany = 0;
    let dupsForThisCompany = 0;

    const insertBatch = db.transaction(() => {
      for (const e of crawlResult.emails) {
        // Check email limit mid-company
        if (opts.emailLimit !== null &&
            stats.totalEmailsFoundThisRun + insertedForThisCompany >= opts.emailLimit) {
          break;
        }

        const info = upsertEmail.run({
          companyId: company.id,
          email: e.email,
          sourceUrl: e.sourceUrl,
          sourceType: classifySourceType(e.sourceUrl),
          emailRole: e.isGeneric ? "generic" : "personal",
        });

        if ((info as { changes: number }).changes > 0) {
          insertedForThisCompany++;
        } else {
          dupsForThisCompany++;
        }
      }
    });

    insertBatch();

    stats.totalEmailsFoundThisRun += insertedForThisCompany;
    stats.totalDuplicatesSkipped  += dupsForThisCompany;

    const crawlStatus = crawlResult.blocked
      ? "blocked"
      : crawlResult.error
        ? "error"
        : crawlResult.emails.length > 0
          ? "done"
          : "done_no_emails";

    // Persist crawl stats and error info back to parent row
    updateCompanyCrawl.run({
      id: company.id,
      crawlStatus,
      crawlError: crawlResult.error ?? null,
      pagesCrawled: crawlResult.pagesCrawled,
      lastCrawledAt: new Date().toISOString(),
      hasContactPage: crawlResult.hasContactPage ? 1 : 0,
      hasAboutPage:   crawlResult.hasAboutPage   ? 1 : 0,
      crawlPayload: JSON.stringify({
        pageResults: crawlResult.pageResults,
        emailsFound: crawlResult.emails.length,
        blocked: crawlResult.blocked,
      }),
    });

    if (crawlResult.error && !crawlResult.blocked) {
      stats.totalFailedCompanies++;
      stats.errors.push(`${domain}: ${crawlResult.error}`);
    }

    console.log(
      `[crawler]   → pages: ${crawlResult.pagesCrawled}, emails: ${crawlResult.emails.length} ` +
      `(${insertedForThisCompany} new, ${dupsForThisCompany} dup) status: ${crawlStatus}`
    );

    // Check limit after company
    if (opts.emailLimit !== null && stats.totalEmailsFoundThisRun >= opts.emailLimit) {
      stats.stoppedByLimit = true;
      break;
    }
  }

  console.log(
    `[crawler] Crawl complete.\n` +
    `  Considered: ${stats.totalCompaniesConsidered}, crawled: ${stats.totalCompaniesCrawled}\n` +
    `  Pages: ${stats.totalPagesCrawled}, emails found: ${stats.totalEmailsFoundThisRun}, ` +
    `dups: ${stats.totalDuplicatesSkipped}\n` +
    `  Failed: ${stats.totalFailedCompanies}, stopped by limit: ${stats.stoppedByLimit}`
  );

  return stats;
}

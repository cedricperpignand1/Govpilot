/**
 * Email crawler for scraped_companies table.
 * Mirrors crawlMiamiCompanyEmails.ts but targets scraped_companies / scraped_company_emails.
 */

import { db } from "./db";
import { crawlCompanyWebsite } from "./emailCrawler";
import {
  CRAWL_INTER_COMPANY_DELAY_MS,
  CRAWL_SKIP_CRAWLED_WITHIN_DAYS,
  CRAWL_MAX_PAGES_PER_COMPANY,
} from "./crawlerConfig";

export interface CrawlOptions {
  emailLimit: number | null;
  maxPagesPerSite: number;
  onlyWithWebsite: boolean;
  onlyWithoutEmails: boolean;
  skipRecentlyCrawledDays: number;
  keyword?: string;
  searchLocation?: string;
}

export const DEFAULT_CRAWL_OPTIONS: CrawlOptions = {
  emailLimit: null,
  maxPagesPerSite: CRAWL_MAX_PAGES_PER_COMPANY,
  onlyWithWebsite: true,
  onlyWithoutEmails: false,
  skipRecentlyCrawledDays: CRAWL_SKIP_CRAWLED_WITHIN_DAYS,
};

const CONCURRENCY = 5; // crawl N companies in parallel

export interface CrawlRunStats {
  totalCompaniesConsidered: number;
  skippedNoWebsite: number;
  skippedNoChange: number;
  skippedRecentlyCrawled: number;
  totalCompaniesCrawled: number;
  totalPagesCrawled: number;
  totalEmailsFoundThisRun: number;
  totalDuplicatesSkipped: number;
  totalFailedCompanies: number;
  stoppedByLimit: boolean;
  emailLimit: number | null;
  errors: string[];
}

interface CompanyForCrawl {
  id: number;
  companyName: string | null;
  website: string | null;
  domain: string | null;
  lastCrawledAt: string | null;
  emailCount: number;
}

function loadEligibleCompanies(keyword?: string, searchLocation?: string): CompanyForCrawl[] {
  const conditions: string[] = ["sc.website IS NOT NULL AND sc.website != ''"];
  const bindings: string[] = [];

  if (keyword)        { conditions.push("LOWER(sc.keyword) LIKE LOWER(?)");        bindings.push(`%${keyword}%`); }
  if (searchLocation) { conditions.push("LOWER(sc.searchLocation) LIKE LOWER(?)"); bindings.push(`%${searchLocation}%`); }

  const where = `WHERE ${conditions.join(" AND ")}`;

  return db.prepare(`
    SELECT
      sc.id, sc.companyName, sc.website, sc.domain, sc.lastCrawledAt,
      COALESCE((SELECT COUNT(*) FROM scraped_company_emails WHERE companyId = sc.id), 0) AS emailCount
    FROM scraped_companies sc
    ${where}
    ORDER BY sc.lastCrawledAt ASC NULLS FIRST, sc.id ASC
  `).all(...bindings) as CompanyForCrawl[];
}

const upsertEmail = db.prepare(`
  INSERT INTO scraped_company_emails (
    companyId, email, sourceUrl, sourceType, emailRole, createdAt, updatedAt
  ) VALUES (
    @companyId, @email, @sourceUrl, @sourceType, @emailRole,
    datetime('now'), datetime('now')
  )
  ON CONFLICT(companyId, email) DO NOTHING
`);

const updateCompanyCrawl = db.prepare(`
  UPDATE scraped_companies SET
    emailCount     = (SELECT COUNT(*) FROM scraped_company_emails WHERE companyId = id),
    crawlStatus    = @crawlStatus,
    crawlError     = @crawlError,
    pagesCrawled   = @pagesCrawled,
    lastCrawledAt  = @lastCrawledAt,
    hasContactPage = @hasContactPage,
    hasAboutPage   = @hasAboutPage,
    crawlPayload   = @crawlPayload,
    phone          = @phone,
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

export async function crawlCompanyEmails(
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

  const allCompanies = loadEligibleCompanies(opts.keyword, opts.searchLocation);
  stats.totalCompaniesConsidered = allCompanies.length;

  const skipBefore = opts.skipRecentlyCrawledDays > 0
    ? new Date(Date.now() - opts.skipRecentlyCrawledDays * 86_400_000).toISOString()
    : null;

  // Filter eligible companies upfront
  const queue: typeof allCompanies = [];
  for (const company of allCompanies) {
    if (!company.website) { stats.skippedNoWebsite++; continue; }
    if (opts.onlyWithoutEmails && company.emailCount > 0) { stats.skippedNoChange++; continue; }
    if (skipBefore && company.lastCrawledAt && company.lastCrawledAt > skipBefore) {
      stats.skippedRecentlyCrawled++; continue;
    }
    queue.push(company);
  }

  // Process one company and save results
  const processCompany = async (company: CompanyForCrawl) => {
    const domain = company.domain ?? (() => {
      try {
        return new URL(company.website!.startsWith("http") ? company.website! : `https://${company.website}`).hostname.replace(/^www\./, "");
      } catch { return null; }
    })();
    if (!domain) { stats.skippedNoWebsite++; return; }

    let crawlResult;
    try {
      crawlResult = await crawlCompanyWebsite(company.website!, domain, opts.maxPagesPerSite);
    } catch (err) {
      const msg = `${domain}: ${String(err)}`;
      stats.totalFailedCompanies++;
      stats.errors.push(msg);
      updateCompanyCrawl.run({
        id: company.id, crawlStatus: "error", crawlError: String(err),
        pagesCrawled: 0, lastCrawledAt: new Date().toISOString(),
        hasContactPage: 0, hasAboutPage: 0, crawlPayload: null, phone: null,
      });
      return;
    }

    stats.totalCompaniesCrawled++;
    stats.totalPagesCrawled += crawlResult.pagesCrawled;

    let insertedForThisCompany = 0;
    let dupsForThisCompany = 0;

    const insertBatch = db.transaction(() => {
      for (const e of crawlResult.emails) {
        if (opts.emailLimit !== null &&
            stats.totalEmailsFoundThisRun + insertedForThisCompany >= opts.emailLimit) break;
        const info = upsertEmail.run({
          companyId: company.id, email: e.email,
          sourceUrl: e.sourceUrl, sourceType: classifySourceType(e.sourceUrl),
          emailRole: e.isGeneric ? "generic" : "personal",
        });
        if ((info as { changes: number }).changes > 0) insertedForThisCompany++;
        else dupsForThisCompany++;
      }
    });
    insertBatch();

    stats.totalEmailsFoundThisRun += insertedForThisCompany;
    stats.totalDuplicatesSkipped  += dupsForThisCompany;

    const crawlStatus = crawlResult.blocked ? "blocked"
      : crawlResult.error ? "error"
      : crawlResult.emails.length > 0 ? "done" : "done_no_emails";

    updateCompanyCrawl.run({
      id: company.id, crawlStatus, crawlError: crawlResult.error ?? null,
      pagesCrawled: crawlResult.pagesCrawled, lastCrawledAt: new Date().toISOString(),
      hasContactPage: crawlResult.hasContactPage ? 1 : 0,
      hasAboutPage:   crawlResult.hasAboutPage   ? 1 : 0,
      crawlPayload: JSON.stringify({ emailsFound: crawlResult.emails.length, blocked: crawlResult.blocked }),
      phone: crawlResult.phone ?? null,
    });

    if (crawlResult.error && !crawlResult.blocked) {
      stats.totalFailedCompanies++;
      stats.errors.push(`${domain}: ${crawlResult.error}`);
    }
  };

  // Run with concurrency pool
  let index = 0;
  const runWorker = async () => {
    while (index < queue.length) {
      if (opts.emailLimit !== null && stats.totalEmailsFoundThisRun >= opts.emailLimit) {
        stats.stoppedByLimit = true;
        break;
      }
      const company = queue[index++];
      await processCompany(company);
    }
  };

  const workers = Array.from({ length: CONCURRENCY }, runWorker);
  await Promise.all(workers);

  console.log(
    `[crawler] Crawl complete. Considered: ${stats.totalCompaniesConsidered}, ` +
    `crawled: ${stats.totalCompaniesCrawled}, emails found: ${stats.totalEmailsFoundThisRun}`
  );

  return stats;
}

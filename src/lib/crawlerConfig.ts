/**
 * Configuration for the Miami company website email crawler.
 *
 * All values here are defaults. The POST /api/miami-companies/crawl-emails
 * endpoint accepts overrides for per-run tuning.
 *
 * To expand this crawler to other regions or use cases:
 *   - The crawler itself is domain-agnostic; only the orchestrator
 *     (crawlMiamiCompanyEmails.ts) is Miami-specific.
 *   - Change the DB query in the orchestrator to target other regions.
 */

// ─── Per-request settings ─────────────────────────────────────────────────────

/** HTTP request timeout per page in milliseconds. */
export const CRAWL_REQUEST_TIMEOUT_MS = 12_000;

/** User-Agent string sent with every request. Identifies the crawler honestly. */
export const CRAWL_USER_AGENT =
  "GovPilot-EmailCrawler/1.0 (polite business-contact discovery; single-site; contact: govpilot-bot)";

/** Maximum number of redirects to follow per request (fetch follows by default). */
export const CRAWL_MAX_REDIRECTS = 5;

// ─── Per-company crawl settings ───────────────────────────────────────────────

/**
 * Maximum number of pages to crawl per company domain.
 * Includes the homepage + fixed paths + discovered links.
 * Can be overridden per run from the UI.
 */
export const CRAWL_MAX_PAGES_PER_COMPANY = 6;

/** Milliseconds to wait between page requests for the SAME company. Politeness. */
export const CRAWL_INTER_PAGE_DELAY_MS = 800;

/** Milliseconds to wait between companies. Prevents hammering shared hosting. */
export const CRAWL_INTER_COMPANY_DELAY_MS = 300;

/** Skip companies crawled within the last N days (prevents re-crawling fresh data). */
export const CRAWL_SKIP_CRAWLED_WITHIN_DAYS = 30;

// ─── Fixed URL paths to try for every company ────────────────────────────────
/**
 * These paths are attempted for every company, in order, up to the page limit.
 * They cover the most common locations for business contact emails.
 */
export const CRAWL_FIXED_PATHS: string[] = [
  "/",
  "/contact",
  "/contact-us",
  "/contactus",
  "/about",
  "/about-us",
  "/aboutus",
  "/team",
  "/staff",
  "/people",
  "/services",
  "/locations",
  "/office",
  "/reach-us",
  "/get-in-touch",
];

// ─── Link discovery on homepage ───────────────────────────────────────────────
/**
 * Keywords used to prioritize internal links discovered on the homepage.
 * If an <a href> contains any of these, it's added to the crawl queue.
 */
export const CRAWL_PRIORITY_LINK_KEYWORDS: string[] = [
  "contact",
  "about",
  "team",
  "staff",
  "people",
  "office",
  "company",
  "reach",
  "touch",
  "email",
  "phone",
  "location",
  "find-us",
];

// ─── Robots.txt ───────────────────────────────────────────────────────────────
/**
 * Whether to check robots.txt before crawling.
 * If true, the crawler fetches /robots.txt and respects Disallow rules
 * for User-agent: * and User-agent: GovPilot-EmailCrawler.
 */
export const CRAWL_RESPECT_ROBOTS_TXT = true;

/** Timeout for fetching robots.txt specifically. Short since it's a quick check. */
export const CRAWL_ROBOTS_TIMEOUT_MS = 4_000;

// ─── Retry settings ───────────────────────────────────────────────────────────
/** Max retry attempts for transient errors (network timeout, 5xx). */
export const CRAWL_MAX_RETRIES = 1;

/** Delay before retrying a failed page request. */
export const CRAWL_RETRY_DELAY_MS = 2_000;

// ─── Crawl job defaults ───────────────────────────────────────────────────────
/**
 * Default email run limit (null = unlimited).
 * Can be overridden from the UI per crawl run.
 */
export const CRAWL_DEFAULT_EMAIL_LIMIT: number | null = null;

/**
 * Whether to skip companies that already have at least one email saved.
 * Can be overridden from the UI.
 */
export const CRAWL_SKIP_COMPANIES_WITH_EMAILS = false;

/**
 * Whether to only crawl companies that have a website URL.
 * (Companies without a website cannot be crawled anyway — this just
 * makes it explicit and logs them as skipped.)
 */
export const CRAWL_ONLY_WITH_WEBSITE = true;

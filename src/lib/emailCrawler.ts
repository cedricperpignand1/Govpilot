/**
 * Single-company website email crawler.
 *
 * For a given company (website URL + domain):
 *   1. Normalize the start URL to https://domain
 *   2. Check robots.txt (if enabled) — mark disallowed paths as off-limits
 *   3. Build a crawl queue: fixed paths + links discovered on homepage
 *   4. Fetch each page (with timeout + retry), respecting same-domain constraint
 *   5. Extract emails from each page's HTML
 *   6. Return all emails found, with per-page source URLs
 *
 * Design principles:
 *   - Polite: inter-page delay, honest User-Agent, robots.txt respected
 *   - Safe: AbortController timeout, max retries, never throws — returns error string instead
 *   - Same-domain only: never follows external links
 *   - Page-limited: stops at CRAWL_MAX_PAGES_PER_COMPANY (overridable)
 */

import {
  CRAWL_REQUEST_TIMEOUT_MS,
  CRAWL_USER_AGENT,
  CRAWL_INTER_PAGE_DELAY_MS,
  CRAWL_FIXED_PATHS,
  CRAWL_PRIORITY_LINK_KEYWORDS,
  CRAWL_RESPECT_ROBOTS_TXT,
  CRAWL_ROBOTS_TIMEOUT_MS,
  CRAWL_MAX_RETRIES,
  CRAWL_RETRY_DELAY_MS,
  CRAWL_MAX_PAGES_PER_COMPANY,
} from "./crawlerConfig";

import {
  extractEmailsFromHtml,
  deduplicateEmails,
  rankEmails,
  extractPhoneFromHtml,
  ExtractedEmail,
} from "./emailExtractor";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CrawlPageResult {
  url: string;
  status: number | null;
  emailsFound: number;
  error: string | null;
  isContactPage: boolean;
  isAboutPage: boolean;
}

export interface CompanyCrawlResult {
  domain: string;
  startUrl: string;
  emails: ExtractedEmail[];
  phone: string | null;
  pageResults: CrawlPageResult[];
  pagesCrawled: number;
  hasContactPage: boolean;
  hasAboutPage: boolean;
  blocked: boolean;   // robots.txt disallowed all crawling
  error: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function normalizeUrl(website: string): string | null {
  try {
    let url = website.trim();
    if (!url.startsWith("http")) url = "https://" + url;
    const parsed = new URL(url);
    // Drop path/query from the start URL — we crawl fixed paths ourselves
    return `${parsed.protocol}//${parsed.hostname}`;
  } catch {
    return null;
  }
}

function isSameDomain(href: string, domain: string): boolean {
  try {
    const u = new URL(href);
    const hDomain = u.hostname.replace(/^www\./i, "").toLowerCase();
    const cDomain = domain.replace(/^www\./i, "").toLowerCase();
    return hDomain === cDomain || hDomain.endsWith(`.${cDomain}`);
  } catch {
    return false;
  }
}

function isContactOrAbout(url: string): { isContact: boolean; isAbout: boolean } {
  const lower = url.toLowerCase();
  return {
    isContact: /\/(contact|contact-us|contactus|reach|touch|get-in-touch)/.test(lower),
    isAbout:   /\/(about|about-us|aboutus|team|staff|people|company)/.test(lower),
  };
}

/**
 * Extract internal links from HTML that are on the same domain
 * and match priority keywords.
 */
function extractPriorityLinks(html: string, baseUrl: string, domain: string): string[] {
  const found: string[] = [];
  const hrefRegex = /href=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;

  while ((m = hrefRegex.exec(html)) !== null) {
    const raw = m[1].trim();
    if (!raw || raw.startsWith("#") || raw.startsWith("javascript:") || raw.startsWith("mailto:")) continue;

    let absolute: string;
    try {
      absolute = new URL(raw, baseUrl).toString();
    } catch {
      continue;
    }

    if (!isSameDomain(absolute, domain)) continue;

    const lowerPath = new URL(absolute).pathname.toLowerCase();
    const matchesKeyword = CRAWL_PRIORITY_LINK_KEYWORDS.some((kw) => lowerPath.includes(kw));
    if (matchesKeyword) found.push(absolute);
  }

  // Deduplicate
  return [...new Set(found)];
}

// ─── Robots.txt ───────────────────────────────────────────────────────────────

interface RobotsRules {
  disallowedPaths: string[];
  crawlDelay: number | null;
}

async function fetchRobotsTxt(baseUrl: string): Promise<RobotsRules> {
  const result: RobotsRules = { disallowedPaths: [], crawlDelay: null };

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CRAWL_ROBOTS_TIMEOUT_MS);

    const res = await fetch(`${baseUrl}/robots.txt`, {
      signal: ctrl.signal,
      headers: { "User-Agent": CRAWL_USER_AGENT },
    });
    clearTimeout(timer);

    if (!res.ok) return result;

    const text = await res.text();
    const lines = text.split(/\r?\n/);

    let applicable = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const [key, ...rest] = trimmed.split(":");
      const value = rest.join(":").trim();

      if (key.toLowerCase() === "user-agent") {
        applicable = value === "*" || value.toLowerCase().includes("govpilot");
      } else if (applicable && key.toLowerCase() === "disallow" && value) {
        result.disallowedPaths.push(value);
      } else if (applicable && key.toLowerCase() === "crawl-delay" && value) {
        result.crawlDelay = parseFloat(value) * 1000 || null;
      }
    }
  } catch {
    // robots.txt not available — proceed without restrictions
  }

  return result;
}

function isDisallowed(pathname: string, rules: RobotsRules): boolean {
  return rules.disallowedPaths.some((d) => {
    if (d === "/") return true; // everything disallowed
    return pathname.startsWith(d);
  });
}

// ─── Page fetcher ─────────────────────────────────────────────────────────────

async function fetchPage(url: string): Promise<{ html: string; status: number } | null> {
  for (let attempt = 1; attempt <= CRAWL_MAX_RETRIES + 1; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), CRAWL_REQUEST_TIMEOUT_MS);

      const res = await fetch(url, {
        signal: ctrl.signal,
        redirect: "follow",
        headers: {
          "User-Agent": CRAWL_USER_AGENT,
          "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
        },
      });
      clearTimeout(timer);

      if (!res.ok) return { html: "", status: res.status };

      // Only parse text/html responses
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("text/html") && !ct.includes("text/plain")) {
        return { html: "", status: res.status };
      }

      const html = await res.text();
      return { html, status: res.status };

    } catch (err: unknown) {
      if (attempt <= CRAWL_MAX_RETRIES) {
        await sleep(CRAWL_RETRY_DELAY_MS);
        continue;
      }
      // Final attempt failed
      return null;
    }
  }
  return null;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Crawl a single company's website and extract all publicly visible emails.
 *
 * @param website     The company's website URL (raw, may or may not have protocol)
 * @param domain      The company's normalized domain (e.g. "example.com")
 * @param maxPages    Maximum number of pages to crawl (overrides config default)
 * @returns           A CompanyCrawlResult (never throws)
 */
export async function crawlCompanyWebsite(
  website: string,
  domain: string,
  maxPages: number = CRAWL_MAX_PAGES_PER_COMPANY
): Promise<CompanyCrawlResult> {
  const result: CompanyCrawlResult = {
    domain,
    startUrl: website,
    emails: [],
    phone: null,
    pageResults: [],
    pagesCrawled: 0,
    hasContactPage: false,
    hasAboutPage: false,
    blocked: false,
    error: null,
  };

  // Normalize base URL
  const baseUrl = normalizeUrl(website);
  if (!baseUrl) {
    result.error = `Cannot normalize URL: ${website}`;
    return result;
  }

  // Check robots.txt
  let robots: RobotsRules = { disallowedPaths: [], crawlDelay: null };
  if (CRAWL_RESPECT_ROBOTS_TXT) {
    robots = await fetchRobotsTxt(baseUrl);
    // If "/" is disallowed, everything is blocked
    if (robots.disallowedPaths.includes("/")) {
      result.blocked = true;
      result.error = "robots.txt disallows all crawling";
      return result;
    }
  }

  // Inter-page delay respects crawl-delay from robots.txt if longer
  const pageDelay = Math.max(
    CRAWL_INTER_PAGE_DELAY_MS,
    robots.crawlDelay ?? 0
  );

  // Build ordered URL queue: fixed paths first, then discovered links
  const queuedUrls: string[] = CRAWL_FIXED_PATHS
    .map((p) => `${baseUrl}${p}`)
    .filter((u) => {
      try {
        return !isDisallowed(new URL(u).pathname, robots);
      } catch {
        return false;
      }
    });

  const visitedUrls = new Set<string>();
  const allEmails: ExtractedEmail[] = [];
  let homepageHtml = ""; // saved for link discovery after first page
  let foundPhone: string | null = null;

  for (const url of queuedUrls) {
    if (result.pagesCrawled >= maxPages) break;
    if (visitedUrls.has(url)) continue;
    visitedUrls.add(url);

    if (result.pagesCrawled > 0) await sleep(pageDelay);

    const page = await fetchPage(url);
    result.pagesCrawled++;

    const { isContact, isAbout } = isContactOrAbout(url);
    if (isContact) result.hasContactPage = true;
    if (isAbout)   result.hasAboutPage   = true;

    if (!page) {
      result.pageResults.push({
        url, status: null, emailsFound: 0,
        error: "Fetch failed (timeout or network error)",
        isContactPage: isContact, isAboutPage: isAbout,
      });
      continue;
    }

    if (page.html) {
      // Save homepage HTML for link discovery
      if (result.pagesCrawled === 1) homepageHtml = page.html;

      const pageEmails = extractEmailsFromHtml(page.html, url);
      allEmails.push(...pageEmails);

      if (!foundPhone) foundPhone = extractPhoneFromHtml(page.html);

      result.pageResults.push({
        url, status: page.status, emailsFound: pageEmails.length,
        error: null, isContactPage: isContact, isAboutPage: isAbout,
      });
    } else {
      result.pageResults.push({
        url, status: page.status, emailsFound: 0,
        error: page.status >= 400 ? `HTTP ${page.status}` : null,
        isContactPage: isContact, isAboutPage: isAbout,
      });
    }

    // After fetching homepage, discover and queue priority internal links
    if (result.pagesCrawled === 1 && homepageHtml) {
      const discovered = extractPriorityLinks(homepageHtml, baseUrl, domain);
      for (const link of discovered) {
        if (!visitedUrls.has(link) && !queuedUrls.includes(link)) {
          try {
            const pathname = new URL(link).pathname;
            if (!isDisallowed(pathname, robots)) {
              queuedUrls.push(link);
            }
          } catch { /* skip malformed */ }
        }
      }
    }
  }

  // Deduplicate and rank emails (company-domain emails first)
  result.emails = rankEmails(deduplicateEmails(allEmails), domain);
  result.phone = foundPhone;

  return result;
}

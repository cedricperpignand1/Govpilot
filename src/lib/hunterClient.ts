/**
 * Hunter.io API client.
 *
 * Endpoints used:
 *   - Domain Search:   GET https://api.hunter.io/v2/domain-search
 *
 * Rate limits:
 *   - Free plan: 25 searches/month
 *   - 429 = quota hit → we stop and surface the error rather than retrying forever
 *
 * Design:
 *   - One function per Hunter endpoint so new endpoints can be added cleanly later
 *   - Pagination handled automatically (offset/limit, max 100/page)
 *   - Returns typed response objects; never throws raw HTTP errors — wraps them
 */

const HUNTER_BASE = "https://api.hunter.io/v2";
const HUNTER_KEY  = process.env.HUNTER_API_KEY ?? "";

const PAGE_LIMIT        = 100;   // max emails per page Hunter allows
const REQUEST_DELAY_MS  = 1_200; // ~50 req/min = well under any plan limit
const RETRY_DELAY_MS    = 8_000; // wait before retrying a 429

// ─── Response types ───────────────────────────────────────────────────────────

export interface HunterEmailSource {
  domain: string | null;
  uri: string | null;
  extracted_on: string | null;
  last_seen_on: string | null;
  still_on_page: boolean | null;
}

export interface HunterEmailEntry {
  value: string;
  type: string | null;          // "personal" | "generic"
  confidence: number;           // 0–100
  sources: HunterEmailSource[];
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  seniority: string | null;
  department: string | null;
  linkedin: string | null;
  twitter: string | null;
  phone_number: string | null;
  verification: {
    date: string | null;
    status: string | null;      // "valid" | "invalid" | "accept_all" | "webmail" | "disposable" | "unknown" | "blocked"
  } | null;
}

export interface HunterDomainSearchData {
  domain: string;
  disposable: boolean;
  webmail: boolean;
  accept_all: boolean;
  pattern: string | null;
  organization: string | null;
  description: string | null;
  industry: string | null;
  twitter: string | null;
  facebook: string | null;
  linkedin: string | null;
  technologies: string[];
  country: string | null;
  state: string | null;
  city: string | null;
  postal_code: string | null;
  street: string | null;
  headcount: string | null;
  company_type: string | null;
  founded_year: number | null;
  emails: HunterEmailEntry[];
  linked_domains: string[];
}

interface HunterDomainSearchResponse {
  data: HunterDomainSearchData;
  meta: {
    results: number;
    limit: number;
    offset: number;
    params: Record<string, unknown>;
  };
}

interface HunterErrorResponse {
  errors: Array<{ id: string; code: number; details: string }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/** Fetch one page of domain search results */
async function fetchDomainSearchPage(
  domain: string,
  offset: number
): Promise<HunterDomainSearchResponse> {
  const url = new URL(`${HUNTER_BASE}/domain-search`);
  url.searchParams.set("domain",  domain);
  url.searchParams.set("api_key", HUNTER_KEY);
  url.searchParams.set("limit",   String(PAGE_LIMIT));
  url.searchParams.set("offset",  String(offset));

  const safeUrl = url.toString().replace(HUNTER_KEY, "REDACTED");

  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (res.status === 429) {
      console.warn(`[Hunter] 429 quota hit (attempt ${attempt}) — ${safeUrl}`);
      if (attempt === 1) { await sleep(RETRY_DELAY_MS); continue; }
      throw Object.assign(new Error("Hunter API quota exceeded (429). Check your monthly limit."), { status: 429 });
    }

    if (res.status === 401 || res.status === 403) {
      throw Object.assign(new Error("Hunter API key is invalid or missing."), { status: res.status });
    }

    if (!res.ok) {
      const body = await res.text();
      let detail = body.slice(0, 300);
      try {
        const parsed: HunterErrorResponse = JSON.parse(body);
        detail = parsed.errors?.[0]?.details ?? detail;
      } catch { /* ignore */ }
      throw Object.assign(new Error(`Hunter API HTTP ${res.status}: ${detail}`), { status: res.status });
    }

    return res.json() as Promise<HunterDomainSearchResponse>;
  }

  throw new Error("Unreachable");
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface DomainSearchResult {
  domain: string;
  organization: string | null;
  emails: HunterEmailEntry[];
  /** Full first-page data (company info, pattern, linked_domains, etc.) */
  companyData: Omit<HunterDomainSearchData, "emails">;
  /** Total email count according to Hunter meta */
  totalResults: number;
}

/**
 * Fetch ALL emails for a domain, paginating automatically.
 * Returns a merged DomainSearchResult.
 *
 * Throws on API key / quota errors so the caller can decide whether to abort
 * the whole sync (quota) or just skip this domain (other errors).
 */
export async function domainSearch(domain: string): Promise<DomainSearchResult> {
  const allEmails: HunterEmailEntry[] = [];
  let offset = 0;
  let totalResults = 0;
  let companyData: Omit<HunterDomainSearchData, "emails"> | null = null;

  do {
    if (offset > 0) await sleep(REQUEST_DELAY_MS);

    const page = await fetchDomainSearchPage(domain, offset);
    totalResults = page.meta.results;

    const { emails, ...rest } = page.data;
    if (!companyData) companyData = rest;  // capture company metadata from first page

    allEmails.push(...emails);
    offset += emails.length;

    if (emails.length === 0) break; // safety exit
  } while (allEmails.length < totalResults);

  return {
    domain,
    organization: companyData?.organization ?? null,
    emails: allEmails,
    companyData: companyData!,
    totalResults,
  };
}

export function hunterKeyConfigured(): boolean {
  return Boolean(HUNTER_KEY) && HUNTER_KEY !== "PASTE_YOUR_HUNTER_API_KEY_HERE";
}

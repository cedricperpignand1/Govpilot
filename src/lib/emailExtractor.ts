/**
 * Email extraction from raw HTML/text content.
 *
 * Methods (applied in order):
 *   1. mailto: href links — highest confidence
 *   2. General regex scan of decoded page text
 *   3. Basic HTML entity + obfuscation decoding before scanning
 *
 * Filtering:
 *   - Skips emails whose TLD is a known file extension (image, script, etc.)
 *   - Skips known junk/example/template domains
 *   - Skips emails with template characters ({, }, etc.)
 *   - Deduplicates case-insensitively
 *
 * Classification:
 *   - "generic" — role-based prefix (info@, contact@, support@, etc.)
 *   - "personal" — likely individual (john.smith@, ceo@, etc.)
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExtractedEmail {
  email: string;       // always lowercase
  sourceUrl: string;   // the page URL where this email was found
  isGeneric: boolean;  // true if the prefix is a known role/generic prefix
}

// ─── Constants ────────────────────────────────────────────────────────────────

// Extensions that indicate a false positive (email pattern inside a filename)
const SKIP_TLDS = new Set([
  "png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp",
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "zip", "rar",
  "js", "ts", "jsx", "tsx", "css", "html", "htm", "xml", "json",
  "woff", "woff2", "ttf", "eot", "otf",
  "mp4", "mp3", "avi", "mov", "wmv",
]);

// Known junk / example / templating domains — not real business emails
const JUNK_DOMAINS = new Set([
  "example.com", "example.org", "example.net",
  "test.com", "test.org", "test.net",
  "domain.com", "yourdomain.com", "youremail.com",
  "email.com", "yoursite.com", "yourcompany.com",
  "sentry.io", "sentry.com",
  "wixpress.com",
  "squarespace.com",
  "wordpress.com",
  "placeholder.com",
  "sample.com",
  "localhost",
]);

// Role-based / generic email prefixes
const GENERIC_PREFIXES = new Set([
  "info", "information", "contact", "contactus",
  "office", "offices",
  "sales", "marketing", "advertising",
  "service", "services", "customerservice", "customer.service",
  "support", "techsupport", "tech.support",
  "hello", "hi", "hey",
  "mail", "email",
  "admin", "administrator",
  "inquiry", "inquiries", "enquiry", "enquiries",
  "help", "helpdesk",
  "billing", "invoice", "invoices", "payments", "accounts",
  "reception", "receptionist", "front.desk",
  "team",
  "general", "general.info", "general.inquiry",
  "business",
  "careers", "jobs", "hiring", "recruitment",
  "hr", "humanresources", "human.resources",
  "no-reply", "noreply", "donotreply", "do-not-reply",
  "webmaster", "postmaster",
  "abuse",
  "legal",
  "pr", "press", "media",
  "news", "newsletter",
  "web", "website", "webinfo",
  "estimates", "estimate", "quote", "quotes",
  "bids", "bid",
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Decode common HTML entities and obfuscation patterns before scanning.
 * Handles the most common cases seen on small business sites.
 */
export function decodeHtmlForEmails(html: string): string {
  return html
    // HTML entity @ sign
    .replace(/&#64;/g, "@")
    .replace(/&#x40;/gi, "@")
    // HTML entity . (dot)
    .replace(/&#46;/g, ".")
    .replace(/&#x2e;/gi, ".")
    // Common word obfuscation for @
    .replace(/\s*\[\s*at\s*\]\s*/gi, "@")
    .replace(/\s*\(\s*at\s*\)\s*/gi, "@")
    .replace(/\s+at\s+(?=[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi, "@")
    // Common word obfuscation for .
    .replace(/\s*\[\s*dot\s*\]\s*/gi, ".")
    .replace(/\s*\(\s*dot\s*\)\s*/gi, ".")
    // Basic HTML entity decode
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function isValidEmail(email: string): boolean {
  if (!email || email.length > 320) return false;

  const atIdx = email.indexOf("@");
  if (atIdx < 1) return false;

  const local  = email.slice(0, atIdx);
  const domain = email.slice(atIdx + 1);

  if (!local || !domain) return false;
  if (local.length > 64 || domain.length > 253) return false;
  if (!domain.includes(".")) return false;

  // Skip if TLD looks like a file extension (false positive)
  const tld = domain.split(".").pop()?.toLowerCase() ?? "";
  if (SKIP_TLDS.has(tld)) return false;

  // Skip known junk domains
  if (JUNK_DOMAINS.has(domain.toLowerCase())) return false;

  // Skip template/placeholder characters
  if (/[{}\[\]<>]/.test(email)) return false;

  // Skip if starts or ends with a dot (malformed)
  if (local.startsWith(".") || local.endsWith(".")) return false;
  if (domain.startsWith(".") || domain.endsWith(".")) return false;

  // Must have at least 2-char TLD
  if (tld.length < 2) return false;

  return true;
}

function classifyEmail(local: string): boolean {
  return GENERIC_PREFIXES.has(local.toLowerCase().replace(/[.\-_]/g, ""));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Extract all valid email addresses from raw HTML content.
 * Returns deduplicated results (by lowercase email address).
 */
export function extractEmailsFromHtml(html: string, sourceUrl: string): ExtractedEmail[] {
  const found = new Map<string, ExtractedEmail>();

  // Decode entities + obfuscation first
  const decoded = decodeHtmlForEmails(html);

  // ── Method 1: mailto: href (most reliable, user-intentional) ──────────────
  const mailtoRegex = /mailto:\s*([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi;
  let m: RegExpExecArray | null;

  while ((m = mailtoRegex.exec(decoded)) !== null) {
    const email = m[1].toLowerCase().trim();
    if (isValidEmail(email) && !found.has(email)) {
      const local = email.split("@")[0];
      found.set(email, { email, sourceUrl, isGeneric: classifyEmail(local) });
    }
  }

  // ── Method 2: General text scan ───────────────────────────────────────────
  // Strip HTML tags first to avoid matching across tag boundaries
  const textOnly = decoded
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ");

  const emailRegex = /\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/g;

  while ((m = emailRegex.exec(textOnly)) !== null) {
    const email = m[1].toLowerCase().trim();
    if (isValidEmail(email) && !found.has(email)) {
      const local = email.split("@")[0];
      found.set(email, { email, sourceUrl, isGeneric: classifyEmail(local) });
    }
  }

  return Array.from(found.values());
}

/**
 * Sort emails for a company: company-domain emails first, then generics,
 * then personal. Within each group, alphabetical.
 */
export function rankEmails(
  emails: ExtractedEmail[],
  companyDomain: string
): ExtractedEmail[] {
  const domain = companyDomain.toLowerCase();

  return [...emails].sort((a, b) => {
    const aOnDomain = a.email.endsWith(`@${domain}`);
    const bOnDomain = b.email.endsWith(`@${domain}`);

    // Same-domain emails first
    if (aOnDomain !== bOnDomain) return aOnDomain ? -1 : 1;

    // Within same-domain: generic before personal
    if (a.isGeneric !== b.isGeneric) return a.isGeneric ? -1 : 1;

    return a.email.localeCompare(b.email);
  });
}

// ─── Phone extraction ─────────────────────────────────────────────────────────

/**
 * Extract the best phone number from raw HTML.
 * Priority: tel: href links first, then text pattern scan.
 * Returns a single normalized string (the first/best one found), or null.
 */
export function extractPhoneFromHtml(html: string): string | null {
  // Method 1: tel: href — most reliable, explicitly placed by site owner
  const telRegex = /href=["']tel:([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = telRegex.exec(html)) !== null) {
    const raw = m[1].replace(/\s+/g, "").trim();
    if (raw.length >= 7) return raw;
  }

  // Method 2: text scan — strip tags first
  const text = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ");

  // Matches formats like: (305) 555-1234 | 305-555-1234 | +1 305 555 1234 | +1.305.555.1234
  const phoneRegex = /(?:\+?1[\s.\-]?)?(?:\((\d{3})\)|(\d{3}))[\s.\-]?(\d{3})[\s.\-]?(\d{4})/g;
  while ((m = phoneRegex.exec(text)) !== null) {
    const area = m[1] ?? m[2];
    const mid  = m[3];
    const end  = m[4];
    if (area && mid && end) return `(${area}) ${mid}-${end}`;
  }

  return null;
}

/**
 * Deduplicate a flat array of ExtractedEmail by email address (case-insensitive).
 * Earlier entries win (preserves source URL from first occurrence).
 */
export function deduplicateEmails(emails: ExtractedEmail[]): ExtractedEmail[] {
  const seen = new Map<string, ExtractedEmail>();
  for (const e of emails) {
    if (!seen.has(e.email)) seen.set(e.email, e);
  }
  return Array.from(seen.values());
}

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "govpilot.db");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Singleton — survives Next.js hot-reload in dev
const globalForDb = global as typeof global & { _govDb?: Database.Database };

export const db: Database.Database =
  globalForDb._govDb ?? (globalForDb._govDb = new Database(DB_PATH));

// WAL mode for better concurrent read performance
db.pragma("journal_mode = WAL");

// ─── Domain extraction utility (canonical source is domainUtils.ts) ──────────
export { extractDomain } from "./domainUtils";

// ─── Schema migrations ───────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS miami_contractors (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    entityName           TEXT,
    legalBusinessName    TEXT,
    uei                  TEXT UNIQUE,
    cageCode             TEXT,
    ncageCode            TEXT,
    physicalAddressLine1 TEXT,
    physicalAddressCity  TEXT,
    physicalAddressState TEXT,
    physicalAddressZip   TEXT,
    country              TEXT,
    naicsCodes           TEXT,   -- JSON array: ["236220","238210",...]
    businessTypes        TEXT,   -- JSON array: ["For Profit Organization",...]
    registrationStatus   TEXT,
    activationDate       TEXT,
    expirationDate       TEXT,
    website              TEXT,
    phone                TEXT,
    rawPayload           TEXT,   -- full SAM entity JSON
    source               TEXT    DEFAULT 'sam_entity_v3',
    createdAt            TEXT    DEFAULT (datetime('now')),
    updatedAt            TEXT    DEFAULT (datetime('now')),
    lastSyncedAt         TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_mc_uei    ON miami_contractors(uei);
  CREATE INDEX IF NOT EXISTS idx_mc_city   ON miami_contractors(physicalAddressCity);
  CREATE INDEX IF NOT EXISTS idx_mc_state  ON miami_contractors(physicalAddressState);
  CREATE INDEX IF NOT EXISTS idx_mc_status ON miami_contractors(registrationStatus);
  CREATE INDEX IF NOT EXISTS idx_mc_zip    ON miami_contractors(physicalAddressZip);
`);

// Safe: add domain column to miami_contractors if it doesn't exist yet
try { db.exec("ALTER TABLE miami_contractors ADD COLUMN domain TEXT"); } catch { /* already exists */ }
try { db.exec("CREATE INDEX IF NOT EXISTS idx_mc_domain ON miami_contractors(domain)"); } catch { /* already exists */ }

// ─── miami_contractor_emails table ──────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS miami_contractor_emails (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    contractorId       INTEGER,          -- FK → miami_contractors.id
    companyName        TEXT,
    domain             TEXT,
    email              TEXT,
    firstName          TEXT,
    lastName           TEXT,
    position           TEXT,
    department         TEXT,
    emailType          TEXT,             -- "personal" | "generic"
    verificationStatus TEXT,             -- "valid" | "invalid" | "accept_all" | "unknown" | ...
    confidence         INTEGER,          -- 0-100
    linkedinUrl        TEXT,
    phone              TEXT,
    source             TEXT DEFAULT 'hunter_domain_search',
    exportable         INTEGER DEFAULT 1,  -- 1 = include in CSV export
    suppressed         INTEGER DEFAULT 0,  -- 1 = do-not-contact
    notes              TEXT,
    rawPayload         TEXT,             -- full Hunter email JSON
    createdAt          TEXT DEFAULT (datetime('now')),
    updatedAt          TEXT DEFAULT (datetime('now')),
    lastEnrichedAt     TEXT,
    UNIQUE(domain, email)
  );

  CREATE INDEX IF NOT EXISTS idx_mce_domain  ON miami_contractor_emails(domain);
  CREATE INDEX IF NOT EXISTS idx_mce_email   ON miami_contractor_emails(email);
  CREATE INDEX IF NOT EXISTS idx_mce_status  ON miami_contractor_emails(verificationStatus);
  CREATE INDEX IF NOT EXISTS idx_mce_cid     ON miami_contractor_emails(contractorId);
`);

// ─── miami_companies table (Google Places source) ────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS miami_companies (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    companyName    TEXT,
    website        TEXT,
    domain         TEXT,
    address        TEXT,
    city           TEXT,
    state          TEXT,
    googlePlaceId  TEXT UNIQUE,
    source         TEXT DEFAULT 'google_places',
    rawPayload     TEXT,
    createdAt      TEXT DEFAULT (datetime('now')),
    updatedAt      TEXT DEFAULT (datetime('now')),
    lastSyncedAt   TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_mgc_domain   ON miami_companies(domain);
  CREATE INDEX IF NOT EXISTS idx_mgc_placeid  ON miami_companies(googlePlaceId);
  CREATE INDEX IF NOT EXISTS idx_mgc_city     ON miami_companies(city);
`);

// Safe: add email-crawl columns to miami_companies (idempotent)
const _crawlCols: [string, string][] = [
  ["emailCount",     "INTEGER DEFAULT 0"],
  ["crawlStatus",    "TEXT"],
  ["crawlError",     "TEXT"],
  ["pagesCrawled",   "INTEGER DEFAULT 0"],
  ["lastCrawledAt",  "TEXT"],
  ["hasContactPage", "INTEGER DEFAULT 0"],
  ["hasAboutPage",   "INTEGER DEFAULT 0"],
  ["crawlPayload",   "TEXT"],
  ["phone",          "TEXT"],
];
for (const [col, def] of _crawlCols) {
  try { db.exec(`ALTER TABLE miami_companies ADD COLUMN ${col} ${def}`); } catch { /* already exists */ }
}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_mgc_crawl ON miami_companies(crawlStatus)"); } catch { /* exists */ }
try { db.exec("CREATE INDEX IF NOT EXISTS idx_mgc_emailcount ON miami_companies(emailCount)"); } catch { /* exists */ }

// ─── miami_company_emails child table ────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS miami_company_emails (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    companyId   INTEGER NOT NULL,
    email       TEXT NOT NULL,
    sourceUrl   TEXT,
    sourceType  TEXT,
    emailRole   TEXT,
    createdAt   TEXT DEFAULT (datetime('now')),
    updatedAt   TEXT DEFAULT (datetime('now')),
    UNIQUE(companyId, email)
  );
  CREATE INDEX IF NOT EXISTS idx_mce2_company ON miami_company_emails(companyId);
  CREATE INDEX IF NOT EXISTS idx_mce2_email   ON miami_company_emails(email);
`);

// ─── Typed row shape ─────────────────────────────────────────────────────────
export interface ContractorRow {
  id: number;
  entityName: string | null;
  legalBusinessName: string | null;
  uei: string | null;
  cageCode: string | null;
  ncageCode: string | null;
  physicalAddressLine1: string | null;
  physicalAddressCity: string | null;
  physicalAddressState: string | null;
  physicalAddressZip: string | null;
  country: string | null;
  naicsCodes: string | null;   // JSON string
  businessTypes: string | null; // JSON string
  registrationStatus: string | null;
  activationDate: string | null;
  expirationDate: string | null;
  website: string | null;
  phone: string | null;
  rawPayload: string | null;   // JSON string
  source: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  lastSyncedAt: string | null;
}

// ─── Query helpers ────────────────────────────────────────────────────────────

export interface ListContractorsParams {
  city?: string;
  state?: string;
  name?: string;        // searches entityName / legalBusinessName
  naics?: string;       // comma-sep; matches if any of the codes is in naicsCodes
  status?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export function listContractors(p: ListContractorsParams): {
  rows: ContractorRow[];
  total: number;
} {
  const {
    city,
    state,
    name,
    naics,
    status,
    sortBy = "entityName",
    sortDir = "asc",
    page = 1,
    pageSize = 50,
  } = p;

  const conditions: string[] = [];
  const bindings: (string | number)[] = [];

  if (city)   { conditions.push("LOWER(physicalAddressCity)  LIKE LOWER(?)"); bindings.push(`%${city}%`); }
  if (state)  { conditions.push("LOWER(physicalAddressState) = LOWER(?)");    bindings.push(state); }
  if (status) { conditions.push("LOWER(registrationStatus)   LIKE LOWER(?)"); bindings.push(`%${status}%`); }
  if (name) {
    conditions.push(
      "(LOWER(entityName) LIKE LOWER(?) OR LOWER(legalBusinessName) LIKE LOWER(?))"
    );
    bindings.push(`%${name}%`, `%${name}%`);
  }
  if (naics) {
    const codes = naics.split(",").map((c) => c.trim()).filter(Boolean);
    if (codes.length > 0) {
      const subConditions = codes.map(() => "naicsCodes LIKE ?");
      conditions.push(`(${subConditions.join(" OR ")})`);
      codes.forEach((c) => bindings.push(`%"${c}"%`));
    }
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Whitelist sortBy to prevent injection
  const ALLOWED_SORT = new Set([
    "entityName", "legalBusinessName", "uei", "cageCode",
    "physicalAddressCity", "physicalAddressZip", "registrationStatus",
    "activationDate", "expirationDate", "lastSyncedAt",
  ]);
  const safeSort = ALLOWED_SORT.has(sortBy) ? sortBy : "entityName";
  const safeDir  = sortDir === "desc" ? "DESC" : "ASC";

  const offset = (page - 1) * pageSize;

  const total = (
    db.prepare(`SELECT COUNT(*) as cnt FROM miami_contractors ${where}`).get(...bindings) as { cnt: number }
  ).cnt;

  const rows = db
    .prepare(
      `SELECT * FROM miami_contractors ${where}
       ORDER BY ${safeSort} ${safeDir}
       LIMIT ? OFFSET ?`
    )
    .all(...bindings, pageSize, offset) as ContractorRow[];

  return { rows, total };
}

// ─── ContractorRow now includes domain ───────────────────────────────────────
// (domain column added via ALTER TABLE above; appears on read automatically)

// ─── ContractorEmailRow ───────────────────────────────────────────────────────
export interface ContractorEmailRow {
  id: number;
  contractorId: number | null;
  companyName: string | null;
  domain: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  position: string | null;
  department: string | null;
  emailType: string | null;
  verificationStatus: string | null;
  confidence: number | null;
  linkedinUrl: string | null;
  phone: string | null;
  source: string | null;
  exportable: number;    // 1 | 0
  suppressed: number;    // 1 | 0
  notes: string | null;
  rawPayload: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  lastEnrichedAt: string | null;
}

export interface ListEmailsParams {
  companyName?: string;
  domain?: string;
  email?: string;
  verificationStatus?: string;
  minConfidence?: number;
  source?: string;
  department?: string;
  onlyWithEmails?: boolean;
  onlyExportable?: boolean;
  hideSuppressed?: boolean;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export function listContractorEmails(p: ListEmailsParams): {
  rows: ContractorEmailRow[];
  total: number;
} {
  const {
    companyName, domain, email, verificationStatus, minConfidence,
    source, department, onlyWithEmails = false, onlyExportable = false,
    hideSuppressed = true,
    sortBy = "companyName", sortDir = "asc", page = 1, pageSize = 50,
  } = p;

  const conditions: string[] = [];
  const bindings: (string | number)[] = [];

  if (companyName)        { conditions.push("LOWER(companyName) LIKE LOWER(?)"); bindings.push(`%${companyName}%`); }
  if (domain)             { conditions.push("LOWER(domain) LIKE LOWER(?)");      bindings.push(`%${domain}%`); }
  if (email)              { conditions.push("LOWER(email) LIKE LOWER(?)");       bindings.push(`%${email}%`); }
  if (verificationStatus) { conditions.push("LOWER(verificationStatus) = LOWER(?)"); bindings.push(verificationStatus); }
  if (source)             { conditions.push("LOWER(source) = LOWER(?)");         bindings.push(source); }
  if (department)         { conditions.push("LOWER(department) LIKE LOWER(?)");  bindings.push(`%${department}%`); }
  if (minConfidence != null) { conditions.push("confidence >= ?");               bindings.push(minConfidence); }
  if (onlyWithEmails)     { conditions.push("email IS NOT NULL AND email != ''"); }
  if (onlyExportable)     { conditions.push("exportable = 1"); }
  if (hideSuppressed)     { conditions.push("suppressed = 0"); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const ALLOWED_SORT = new Set([
    "companyName", "domain", "email", "firstName", "lastName",
    "position", "department", "verificationStatus", "confidence",
    "emailType", "lastEnrichedAt",
  ]);
  const safeSort = ALLOWED_SORT.has(sortBy) ? sortBy : "companyName";
  const safeDir  = sortDir === "desc" ? "DESC" : "ASC";
  const offset   = (page - 1) * pageSize;

  const total = (
    db.prepare(`SELECT COUNT(*) as cnt FROM miami_contractor_emails ${where}`).get(...bindings) as { cnt: number }
  ).cnt;

  const rows = db
    .prepare(
      `SELECT * FROM miami_contractor_emails ${where}
       ORDER BY ${safeSort} ${safeDir}
       LIMIT ? OFFSET ?`
    )
    .all(...bindings, pageSize, offset) as ContractorEmailRow[];

  return { rows, total };
}

export function getEmailSummaryStats(): {
  totalWithDomain: number;
  totalEnriched: number;
  totalEmails: number;
  verifiedEmails: number;
  uniqueDomains: number;
  lastEnrichedAt: string | null;
} {
  const emailStats = db.prepare(`
    SELECT
      COUNT(*)                        AS totalEmails,
      SUM(CASE WHEN verificationStatus = 'valid' THEN 1 ELSE 0 END) AS verifiedEmails,
      COUNT(DISTINCT domain)          AS uniqueDomains,
      MAX(lastEnrichedAt)             AS lastEnrichedAt
    FROM miami_contractor_emails
    WHERE suppressed = 0
  `).get() as {
    totalEmails: number;
    verifiedEmails: number;
    uniqueDomains: number;
    lastEnrichedAt: string | null;
  };

  // Count domains from BOTH source tables (miami_contractors + miami_companies)
  const withDomain = (db.prepare(`
    SELECT (
      SELECT COUNT(*) FROM miami_contractors WHERE domain IS NOT NULL AND domain != ''
    ) + (
      SELECT COUNT(*) FROM miami_companies WHERE domain IS NOT NULL AND domain != ''
    ) AS cnt
  `).get() as { cnt: number }).cnt;

  const enriched = (db.prepare(
    "SELECT COUNT(DISTINCT domain) AS cnt FROM miami_contractor_emails"
  ).get() as { cnt: number }).cnt;

  return {
    totalWithDomain: withDomain,
    totalEnriched: enriched,
    totalEmails: emailStats.totalEmails,
    verifiedEmails: emailStats.verifiedEmails,
    uniqueDomains: emailStats.uniqueDomains,
    lastEnrichedAt: emailStats.lastEnrichedAt,
  };
}

export function getSummaryStats(): {
  total: number;
  uniqueZips: number;
  uniqueNaics: number;
  lastSyncedAt: string | null;
} {
  const row = db
    .prepare(
      `SELECT
         COUNT(*)                       AS total,
         COUNT(DISTINCT physicalAddressZip) AS uniqueZips,
         MAX(lastSyncedAt)              AS lastSyncedAt
       FROM miami_contractors`
    )
    .get() as { total: number; uniqueZips: number; lastSyncedAt: string | null };

  // Count unique NAICS codes across all rows (stored as JSON arrays)
  const allNaics = db
    .prepare("SELECT naicsCodes FROM miami_contractors WHERE naicsCodes IS NOT NULL")
    .all() as { naicsCodes: string }[];

  const naicsSet = new Set<string>();
  for (const r of allNaics) {
    try {
      const codes: string[] = JSON.parse(r.naicsCodes);
      codes.forEach((c) => naicsSet.add(c));
    } catch { /* ignore malformed rows */ }
  }

  return {
    total: row.total,
    uniqueZips: row.uniqueZips,
    uniqueNaics: naicsSet.size,
    lastSyncedAt: row.lastSyncedAt,
  };
}

// ─── miami_companies types + helpers ─────────────────────────────────────────

export interface CompanyRow {
  id: number;
  companyName: string | null;
  website: string | null;
  domain: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  googlePlaceId: string | null;
  source: string | null;
  rawPayload: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  lastSyncedAt: string | null;
  // Email crawl fields (may be null if crawl hasn't run)
  emailCount: number;
  emailsList: string | null;    // pipe-separated: "a@b.com|||c@d.com"
  crawlStatus: string | null;
  crawlError: string | null;
  pagesCrawled: number;
  lastCrawledAt: string | null;
  hasContactPage: number;
  hasAboutPage: number;
  crawlPayload: string | null;
  phone: string | null;
}

export interface ListCompaniesParams {
  name?: string;
  domain?: string;
  city?: string;
  state?: string;
  onlyWithWebsite?: boolean;
  onlyWithEmails?: boolean;
  minEmailCount?: number;
  crawlStatus?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export function listMiamiCompanies(p: ListCompaniesParams): { rows: CompanyRow[]; total: number } {
  const {
    name, domain, city, state,
    onlyWithWebsite = false, onlyWithEmails = false, minEmailCount,
    crawlStatus,
    sortBy = "companyName", sortDir = "asc", page = 1, pageSize = 50,
  } = p;

  const conditions: string[] = [];
  const bindings: (string | number)[] = [];

  if (name)          { conditions.push("LOWER(mc.companyName) LIKE LOWER(?)"); bindings.push(`%${name}%`); }
  if (domain)        { conditions.push("LOWER(mc.domain) LIKE LOWER(?)");      bindings.push(`%${domain}%`); }
  if (city)          { conditions.push("LOWER(mc.city) LIKE LOWER(?)");        bindings.push(`%${city}%`); }
  if (state)         { conditions.push("LOWER(mc.state) = LOWER(?)");          bindings.push(state); }
  if (crawlStatus)   { conditions.push("mc.crawlStatus = ?");                  bindings.push(crawlStatus); }
  if (onlyWithWebsite) { conditions.push("mc.website IS NOT NULL AND mc.website != ''"); }
  if (onlyWithEmails)  { conditions.push("(SELECT COUNT(*) FROM miami_company_emails WHERE companyId = mc.id) > 0"); }
  if (minEmailCount != null && minEmailCount > 0) {
    conditions.push("(SELECT COUNT(*) FROM miami_company_emails WHERE companyId = mc.id) >= ?");
    bindings.push(minEmailCount);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const ALLOWED_SORT = new Set([
    "companyName", "domain", "city", "state", "lastSyncedAt",
    "emailCount", "lastCrawledAt", "crawlStatus",
  ]);
  const safeSort = ALLOWED_SORT.has(sortBy) ? `mc.${sortBy}` : "mc.companyName";
  const safeDir  = sortDir === "desc" ? "DESC" : "ASC";
  const offset   = (page - 1) * pageSize;

  // Total count (without email aggregation for performance)
  const total = (
    db.prepare(`SELECT COUNT(*) AS cnt FROM miami_companies mc ${where}`).get(...bindings) as { cnt: number }
  ).cnt;

  // Full row query with email aggregation via LEFT JOIN
  const rows = db.prepare(`
    SELECT
      mc.*,
      COALESCE(e.emailCount, 0)   AS emailCount,
      e.emailsList                AS emailsList
    FROM miami_companies mc
    LEFT JOIN (
      SELECT
        companyId,
        COUNT(*)                           AS emailCount,
        GROUP_CONCAT(email, '|||')         AS emailsList
      FROM miami_company_emails
      GROUP BY companyId
    ) e ON e.companyId = mc.id
    ${where}
    ORDER BY ${safeSort} ${safeDir}
    LIMIT ? OFFSET ?
  `).all(...bindings, pageSize, offset) as CompanyRow[];

  return { rows, total };
}

export function getMiamiCompaniesSummary(): {
  total: number;
  withWebsite: number;
  withDomain: number;
  withEmails: number;
  totalEmailsFound: number;
  lastSyncedAt: string | null;
  lastCrawledAt: string | null;
} {
  const row = db.prepare(`
    SELECT
      COUNT(*)                                                                AS total,
      SUM(CASE WHEN website IS NOT NULL AND website != '' THEN 1 ELSE 0 END) AS withWebsite,
      SUM(CASE WHEN domain  IS NOT NULL AND domain  != '' THEN 1 ELSE 0 END) AS withDomain,
      SUM(CASE WHEN emailCount > 0 THEN 1 ELSE 0 END)                        AS withEmails,
      MAX(lastSyncedAt)                                                       AS lastSyncedAt,
      MAX(lastCrawledAt)                                                      AS lastCrawledAt
    FROM miami_companies
  `).get() as {
    total: number; withWebsite: number; withDomain: number;
    withEmails: number; lastSyncedAt: string | null; lastCrawledAt: string | null;
  };

  const totalEmailsFound = (db.prepare(
    "SELECT COUNT(*) AS cnt FROM miami_company_emails"
  ).get() as { cnt: number }).cnt;

  return { ...row, totalEmailsFound };
}

// ─── scraped_companies table (generic keyword+location search) ───────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS scraped_companies (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    companyName    TEXT,
    website        TEXT,
    domain         TEXT,
    address        TEXT,
    city           TEXT,
    state          TEXT,
    googlePlaceId  TEXT UNIQUE,
    keyword        TEXT,
    searchLocation TEXT,
    source         TEXT DEFAULT 'google_places',
    rawPayload     TEXT,
    createdAt      TEXT DEFAULT (datetime('now')),
    updatedAt      TEXT DEFAULT (datetime('now')),
    lastSyncedAt   TEXT,
    emailCount     INTEGER DEFAULT 0,
    crawlStatus    TEXT,
    crawlError     TEXT,
    pagesCrawled   INTEGER DEFAULT 0,
    lastCrawledAt  TEXT,
    hasContactPage INTEGER DEFAULT 0,
    hasAboutPage   INTEGER DEFAULT 0,
    crawlPayload   TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_sc_domain    ON scraped_companies(domain);
  CREATE INDEX IF NOT EXISTS idx_sc_placeid   ON scraped_companies(googlePlaceId);
  CREATE INDEX IF NOT EXISTS idx_sc_keyword   ON scraped_companies(keyword);
  CREATE INDEX IF NOT EXISTS idx_sc_location  ON scraped_companies(searchLocation);
  CREATE INDEX IF NOT EXISTS idx_sc_crawl     ON scraped_companies(crawlStatus);


  CREATE TABLE IF NOT EXISTS scraped_company_emails (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    companyId   INTEGER NOT NULL,
    email       TEXT NOT NULL,
    sourceUrl   TEXT,
    sourceType  TEXT,
    emailRole   TEXT,
    createdAt   TEXT DEFAULT (datetime('now')),
    updatedAt   TEXT DEFAULT (datetime('now')),
    UNIQUE(companyId, email)
  );
  CREATE INDEX IF NOT EXISTS idx_sce_company ON scraped_company_emails(companyId);
  CREATE INDEX IF NOT EXISTS idx_sce_email   ON scraped_company_emails(email);
`);

// Safe: add phone column to scraped_companies (idempotent)
try { db.exec("ALTER TABLE scraped_companies ADD COLUMN phone TEXT"); } catch { /* already exists */ }

// ─── ScrapedCompanyRow type + helpers ────────────────────────────────────────

export interface ScrapedCompanyRow {
  id: number;
  companyName: string | null;
  website: string | null;
  domain: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  googlePlaceId: string | null;
  keyword: string | null;
  searchLocation: string | null;
  source: string | null;
  rawPayload: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  lastSyncedAt: string | null;
  emailCount: number;
  emailsList: string | null;
  crawlStatus: string | null;
  crawlError: string | null;
  pagesCrawled: number;
  lastCrawledAt: string | null;
  hasContactPage: number;
  hasAboutPage: number;
  crawlPayload: string | null;
  phone: string | null;
}

export interface ListScrapedCompaniesParams {
  name?: string;
  domain?: string;
  city?: string;
  state?: string;
  keyword?: string;
  searchLocation?: string;
  onlyWithWebsite?: boolean;
  onlyWithEmails?: boolean;
  minEmailCount?: number;
  crawlStatus?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export function listScrapedCompanies(p: ListScrapedCompaniesParams): { rows: ScrapedCompanyRow[]; total: number } {
  const {
    name, domain, city, state, keyword, searchLocation,
    onlyWithWebsite = false, onlyWithEmails = false, minEmailCount,
    crawlStatus,
    sortBy = "companyName", sortDir = "asc", page = 1, pageSize = 50,
  } = p;

  const conditions: string[] = [];
  const bindings: (string | number)[] = [];

  if (name)           { conditions.push("LOWER(sc.companyName) LIKE LOWER(?)");    bindings.push(`%${name}%`); }
  if (domain)         { conditions.push("LOWER(sc.domain) LIKE LOWER(?)");         bindings.push(`%${domain}%`); }
  if (city)           { conditions.push("LOWER(sc.city) LIKE LOWER(?)");           bindings.push(`%${city}%`); }
  if (state)          { conditions.push("LOWER(sc.state) = LOWER(?)");             bindings.push(state); }
  if (keyword)        { conditions.push("LOWER(sc.keyword) LIKE LOWER(?)");        bindings.push(`%${keyword}%`); }
  if (searchLocation) { conditions.push("LOWER(sc.searchLocation) LIKE LOWER(?)"); bindings.push(`%${searchLocation}%`); }
  if (crawlStatus)    { conditions.push("sc.crawlStatus = ?");                     bindings.push(crawlStatus); }
  if (onlyWithWebsite)  { conditions.push("sc.website IS NOT NULL AND sc.website != ''"); }
  if (onlyWithEmails)   { conditions.push("(SELECT COUNT(*) FROM scraped_company_emails WHERE companyId = sc.id) > 0"); }
  if (minEmailCount != null && minEmailCount > 0) {
    conditions.push("(SELECT COUNT(*) FROM scraped_company_emails WHERE companyId = sc.id) >= ?");
    bindings.push(minEmailCount);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const ALLOWED_SORT = new Set([
    "companyName", "domain", "city", "state", "keyword", "searchLocation",
    "lastSyncedAt", "emailCount", "lastCrawledAt", "crawlStatus",
  ]);
  const safeSort = ALLOWED_SORT.has(sortBy) ? `sc.${sortBy}` : "sc.companyName";
  const safeDir  = sortDir === "desc" ? "DESC" : "ASC";
  const offset   = (page - 1) * pageSize;

  const total = (
    db.prepare(`SELECT COUNT(*) AS cnt FROM scraped_companies sc ${where}`).get(...bindings) as { cnt: number }
  ).cnt;

  const rows = db.prepare(`
    SELECT
      sc.*,
      COALESCE(e.emailCount, 0) AS emailCount,
      e.emailsList              AS emailsList
    FROM scraped_companies sc
    LEFT JOIN (
      SELECT companyId, COUNT(*) AS emailCount, GROUP_CONCAT(email, '|||') AS emailsList
      FROM scraped_company_emails GROUP BY companyId
    ) e ON e.companyId = sc.id
    ${where}
    ORDER BY ${safeSort} ${safeDir}
    LIMIT ? OFFSET ?
  `).all(...bindings, pageSize, offset) as ScrapedCompanyRow[];

  return { rows, total };
}

export function getScrapedCompaniesSummary(keyword?: string, searchLocation?: string): {
  total: number;
  withWebsite: number;
  withDomain: number;
  withEmails: number;
  totalEmailsFound: number;
  lastSyncedAt: string | null;
  lastCrawledAt: string | null;
} {
  const conditions: string[] = [];
  const bindings: string[] = [];
  if (keyword)        { conditions.push("LOWER(keyword) LIKE LOWER(?)");        bindings.push(`%${keyword}%`); }
  if (searchLocation) { conditions.push("LOWER(searchLocation) LIKE LOWER(?)"); bindings.push(`%${searchLocation}%`); }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const row = db.prepare(`
    SELECT
      COUNT(*)                                                                AS total,
      SUM(CASE WHEN website IS NOT NULL AND website != '' THEN 1 ELSE 0 END) AS withWebsite,
      SUM(CASE WHEN domain  IS NOT NULL AND domain  != '' THEN 1 ELSE 0 END) AS withDomain,
      SUM(CASE WHEN emailCount > 0 THEN 1 ELSE 0 END)                        AS withEmails,
      MAX(lastSyncedAt)                                                       AS lastSyncedAt,
      MAX(lastCrawledAt)                                                      AS lastCrawledAt
    FROM scraped_companies ${where}
  `).get(...bindings) as {
    total: number; withWebsite: number; withDomain: number;
    withEmails: number; lastSyncedAt: string | null; lastCrawledAt: string | null;
  };

  const emailRow = db.prepare(`
    SELECT COUNT(*) AS cnt FROM scraped_company_emails
    WHERE companyId IN (SELECT id FROM scraped_companies ${where})
  `).get(...bindings) as { cnt: number };

  return { ...row, totalEmailsFound: emailRow.cnt };
}

// ─── Unified domain source for Hunter sync ───────────────────────────────────
/** Returns all Miami companies (from both sources) that have or can derive a domain. */
export interface DomainSource {
  id: number;
  companyName: string | null;
  website: string | null;
  domain: string | null;
  sourceTable: "miami_contractors" | "miami_companies";
}

export function listDomainsForHunterSync(): DomainSource[] {
  return db.prepare(`
    SELECT
      id,
      COALESCE(entityName, legalBusinessName) AS companyName,
      website,
      domain,
      'miami_contractors' AS sourceTable
    FROM miami_contractors
    WHERE LOWER(physicalAddressCity) = 'miami'

    UNION ALL

    SELECT
      id,
      companyName,
      website,
      domain,
      'miami_companies' AS sourceTable
    FROM miami_companies

    ORDER BY companyName ASC
  `).all() as DomainSource[];
}

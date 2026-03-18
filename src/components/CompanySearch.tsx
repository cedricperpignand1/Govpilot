"use client";

import { useState, useEffect, useCallback, useRef } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Company {
  id: number;
  companyName: string | null;
  website: string | null;
  domain: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  keyword: string | null;
  searchLocation: string | null;
  lastSyncedAt: string | null;
  emailCount: number | null;
  emailsList: string | null;
  crawlStatus: string | null;
  crawlError: string | null;
  pagesCrawled: number | null;
  lastCrawledAt: string | null;
  phone: string | null;
}

interface Summary {
  total: number;
  withWebsite: number;
  withDomain: number;
  withEmails: number;
  totalEmailsFound: number;
  lastSyncedAt: string | null;
  lastCrawledAt: string | null;
}

interface SyncStats {
  keyword: string;
  searchLocation: string;
  queriesTotal: number;
  queriesExecuted: number;
  rawPlacesFound: number;
  uniquePlacesToProcess: number;
  skippedAlreadyInDb: number;
  skippedNoWebsite: number;
  companiesSaved: number;
  inserted: number;
  updated: number;
  errors: string[];
  stoppedEarly: boolean;
}

interface CrawlRunStats {
  totalCompaniesConsidered: number;
  totalCompaniesCrawled: number;
  totalEmailsFoundThisRun: number;
  totalDuplicatesSkipped: number;
  totalFailedCompanies: number;
  stoppedByLimit: boolean;
  emailLimit: number | null;
  errors: string[];
}

interface CrawlOptions {
  emailLimitMode: "unlimited" | "limited";
  emailLimit: number;
  maxPagesPerSite: number;
  onlyWithoutEmails: boolean;
  skipRecentlyCrawledDays: number;
}

interface Filters {
  name: string;
  domain: string;
  city: string;
  keyword: string;
  searchLocation: string;
  onlyWithWebsite: boolean;
  onlyWithEmails: boolean;
  crawlStatus: string;
  minEmailCount: string;
}

type SortDir = "asc" | "desc";
const PAGE_SIZE = 50;

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString(); } catch { return iso; }
}

function crawlStatusBadge(status: string | null) {
  if (!status) return <span className="mgc-badge mgc-badge-none">—</span>;
  const map: Record<string, string> = {
    done:          "mgc-badge-done",
    done_no_emails:"mgc-badge-noemail",
    error:         "mgc-badge-error",
    blocked:       "mgc-badge-blocked",
  };
  return (
    <span className={`mgc-badge ${map[status] ?? "mgc-badge-none"}`}>
      {status === "done_no_emails" ? "DONE_NO_EMAILS" : status.toUpperCase()}
    </span>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CompanySearch() {
  // Search inputs
  const [keyword, setKeyword]               = useState("");
  const [location, setLocation]             = useState("");
  const [keywordVariations, setKeywordVariations] = useState("");

  const [rows, setRows]               = useState<Company[]>([]);
  const [total, setTotal]             = useState(0);
  const [page, setPage]               = useState(1);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [syncing, setSyncing]         = useState(false);
  const [syncResult, setSyncResult]   = useState<SyncStats | null>(null);
  const [crawling, setCrawling]       = useState(false);
  const [crawlResult, setCrawlResult] = useState<CrawlRunStats | null>(null);
  const [summary, setSummary]         = useState<Summary | null>(null);
  const [selected, setSelected]       = useState<Company | null>(null);
  const [exporting, setExporting]     = useState(false);
  const [sortBy, setSortBy]           = useState("companyName");
  const [sortDir, setSortDir]         = useState<SortDir>("asc");
  const [showCrawlControls, setShowCrawlControls] = useState(false);

  const [crawlOptions, setCrawlOptions] = useState<CrawlOptions>({
    emailLimitMode: "unlimited",
    emailLimit: 500,
    maxPagesPerSite: 6,
    onlyWithoutEmails: false,
    skipRecentlyCrawledDays: 30,
  });

  const [filters, setFilters] = useState<Filters>({
    name: "", domain: "", city: "", keyword: "", searchLocation: "",
    onlyWithWebsite: false, onlyWithEmails: false,
    crawlStatus: "", minEmailCount: "",
  });

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debounced, setDebounced] = useState<Partial<Filters>>({});

  const handleTextFilter = (key: keyof Filters, val: string) => {
    setFilters((f) => ({ ...f, [key]: val }));
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebounced((d) => ({ ...d, [key]: val })), 350);
  };

  // ── Fetch ───────────────────────────────────────────────────────────────────

  const fetchRows = useCallback(async (p = 1) => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      if (debounced.name)           sp.set("name",           debounced.name);
      if (debounced.domain)         sp.set("domain",         debounced.domain);
      if (debounced.city)           sp.set("city",           debounced.city);
      if (debounced.keyword || filters.keyword)
        sp.set("keyword",       debounced.keyword ?? filters.keyword);
      if (debounced.searchLocation || filters.searchLocation)
        sp.set("searchLocation", debounced.searchLocation ?? filters.searchLocation);
      if (filters.onlyWithWebsite)  sp.set("onlyWithWebsite", "true");
      if (filters.onlyWithEmails)   sp.set("onlyWithEmails",  "true");
      if (filters.crawlStatus)      sp.set("crawlStatus", filters.crawlStatus);
      if (filters.minEmailCount)    sp.set("minEmailCount", filters.minEmailCount);
      sp.set("sortBy",   sortBy);
      sp.set("sortDir",  sortDir);
      sp.set("page",     String(p));
      sp.set("pageSize", String(PAGE_SIZE));

      const res  = await fetch(`/api/companies?${sp}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setRows(json.rows);
      setTotal(json.total);
      setPage(p);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [debounced, filters.keyword, filters.searchLocation, filters.onlyWithWebsite,
      filters.onlyWithEmails, filters.crawlStatus, filters.minEmailCount, sortBy, sortDir]);

  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetch("/api/companies?summary=true");
      if (res.ok) setSummary(await res.json());
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchRows(1); }, [fetchRows]);
  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  // ── Sync ────────────────────────────────────────────────────────────────────

  const handleSync = async () => {
    if (!keyword.trim() || !location.trim()) {
      setError("Please enter both a keyword and a location before syncing.");
      return;
    }
    setSyncing(true);
    setSyncResult(null);
    setError(null);
    try {
      const res  = await fetch("/api/companies/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword: keyword.trim(),
          location: location.trim(),
          extraKeywords: keywordVariations
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? `HTTP ${res.status}`);
      setSyncResult(json.stats);
      // Auto-filter to just-synced results
      setFilters((f) => ({ ...f, keyword: keyword.trim(), searchLocation: location.trim() }));
      setDebounced((d) => ({ ...d, keyword: keyword.trim(), searchLocation: location.trim() }));
      await fetchSummary();
    } catch (err) {
      setError(String(err));
    } finally {
      setSyncing(false);
    }
  };

  // ── Crawl Emails ────────────────────────────────────────────────────────────

  const handleCrawl = async () => {
    setCrawling(true);
    setCrawlResult(null);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        maxPagesPerSite:         crawlOptions.maxPagesPerSite,
        onlyWithoutEmails:       crawlOptions.onlyWithoutEmails,
        skipRecentlyCrawledDays: crawlOptions.skipRecentlyCrawledDays,
        emailLimit: crawlOptions.emailLimitMode === "limited" ? crawlOptions.emailLimit : null,
        keyword:        filters.keyword        || undefined,
        searchLocation: filters.searchLocation || undefined,
      };
      const res  = await fetch("/api/companies/crawl-emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? `HTTP ${res.status}`);
      setCrawlResult(json.stats);
      await fetchRows(1);
      await fetchSummary();
    } catch (err) {
      setError(String(err));
    } finally {
      setCrawling(false);
    }
  };

  // ── Export ──────────────────────────────────────────────────────────────────

  const handleExport = async () => {
    setExporting(true);
    try {
      const sp = new URLSearchParams();
      if (filters.keyword)        sp.set("keyword",        filters.keyword);
      if (filters.searchLocation) sp.set("searchLocation", filters.searchLocation);
      if (debounced.name)   sp.set("name",   debounced.name ?? "");
      if (debounced.domain) sp.set("domain", debounced.domain ?? "");
      if (filters.onlyWithWebsite) sp.set("onlyWithWebsite", "true");
      if (filters.onlyWithEmails)  sp.set("onlyWithEmails",  "true");
      if (filters.crawlStatus)     sp.set("crawlStatus", filters.crawlStatus);

      const res = await fetch(`/api/companies/export?${sp}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = "companies-export.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(String(err));
    } finally {
      setExporting(false);
    }
  };

  // ── Sort ─────────────────────────────────────────────────────────────────────

  const handleSort = (col: string) => {
    if (sortBy === col) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortBy(col); setSortDir("asc"); }
  };

  const sortIcon = (col: string) => (
    <span className={`mgc-sort ${sortBy === col ? "active" : ""}`}>
      {sortBy === col ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
    </span>
  );

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="mgc-page">

      {/* ── Summary Cards ────────────────────────────────────────────── */}
      <div className="mgc-cards mgc-cards-7">
        {([
          ["Total Companies",    summary?.total            ?? "—"],
          ["With Website",       summary?.withWebsite      ?? "—"],
          ["Domains Extracted",  summary?.withDomain       ?? "—"],
          ["With Emails",        summary?.withEmails       ?? "—"],
          ["Total Emails Found", summary?.totalEmailsFound ?? "—"],
          ["Last Company Sync",  fmtDate(summary?.lastSyncedAt)],
          ["Last Email Crawl",   fmtDate(summary?.lastCrawledAt)],
        ] as [string, string | number][]).map(([label, val]) => (
          <div key={label} className="mgc-card">
            <span className={`mgc-card-val ${typeof val === "string" && val.includes("/") ? "mgc-card-date" : ""}`}>
              {val}
            </span>
            <span className="mgc-card-label">{label}</span>
          </div>
        ))}
      </div>

      {/* ── Search Bar ───────────────────────────────────────────────── */}
      <div className="mgc-search-bar">
        <input
          className="mgc-search-input mgc-search-keyword"
          type="text"
          placeholder='Keyword — e.g. "architects", "dentists"'
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSync(); }}
        />
        <input
          className="mgc-search-input mgc-search-location"
          type="text"
          placeholder='City/State — e.g. "Miami, New York, Austin"'
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSync(); }}
        />
        <input
          className="mgc-search-input mgc-search-variations"
          type="text"
          placeholder='Keyword variations (optional) — e.g. "real estate agent, real estate broker"'
          value={keywordVariations}
          onChange={(e) => setKeywordVariations(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSync(); }}
        />
        <button
          className="mgc-btn mgc-btn-sync"
          onClick={handleSync}
          disabled={syncing || !keyword.trim() || !location.trim()}
        >
          {syncing ? "Searching…" : "Search Companies"}
        </button>
      </div>

      {/* ── Action Buttons ───────────────────────────────────────────── */}
      <div className="mgc-actions">
        <button
          className="mgc-btn mgc-btn-crawl"
          onClick={handleCrawl}
          disabled={crawling || total === 0}
        >
          {crawling ? "Crawling…" : "Crawl Emails"}
        </button>
        <button
          className="mgc-btn mgc-btn-options"
          onClick={() => setShowCrawlControls((v) => !v)}
        >
          Crawl Options
        </button>
        <button
          className="mgc-btn mgc-btn-refresh"
          onClick={() => { fetchRows(1); fetchSummary(); }}
          disabled={loading}
        >
          Refresh
        </button>
        <button
          className="mgc-btn mgc-btn-export"
          onClick={handleExport}
          disabled={exporting || total === 0}
        >
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
        <span className="mgc-total-label">{total} companies</span>
      </div>

      {/* ── Crawl Options Panel ──────────────────────────────────────── */}
      {showCrawlControls && (
        <div className="mgc-crawl-options">
          <label>
            Email limit:&nbsp;
            <select
              value={crawlOptions.emailLimitMode}
              onChange={(e) => setCrawlOptions((o) => ({
                ...o, emailLimitMode: e.target.value as CrawlOptions["emailLimitMode"],
              }))}
            >
              <option value="unlimited">Unlimited</option>
              <option value="limited">Limited</option>
            </select>
          </label>
          {crawlOptions.emailLimitMode === "limited" && (
            <label>
              Max emails:&nbsp;
              <input
                type="number" min={1}
                value={crawlOptions.emailLimit}
                onChange={(e) => setCrawlOptions((o) => ({ ...o, emailLimit: Number(e.target.value) }))}
                style={{ width: 80 }}
              />
            </label>
          )}
          <label>
            Max pages/site:&nbsp;
            <input
              type="number" min={1} max={20}
              value={crawlOptions.maxPagesPerSite}
              onChange={(e) => setCrawlOptions((o) => ({ ...o, maxPagesPerSite: Number(e.target.value) }))}
              style={{ width: 60 }}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={crawlOptions.onlyWithoutEmails}
              onChange={(e) => setCrawlOptions((o) => ({ ...o, onlyWithoutEmails: e.target.checked }))}
            />
            &nbsp;Only companies without emails yet
          </label>
          <label>
            Skip if crawled within&nbsp;
            <input
              type="number" min={0}
              value={crawlOptions.skipRecentlyCrawledDays}
              onChange={(e) => setCrawlOptions((o) => ({ ...o, skipRecentlyCrawledDays: Number(e.target.value) }))}
              style={{ width: 60 }}
            />
            &nbsp;days
          </label>
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────────────── */}
      {error && (
        <div className="mgc-error">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* ── Sync Result ──────────────────────────────────────────────── */}
      {syncResult && (
        <div className="mgc-result-box">
          <strong>Sync complete</strong> — "{syncResult.keyword}" in "{syncResult.searchLocation}"
          &nbsp;|&nbsp;{syncResult.queriesExecuted}/{syncResult.queriesTotal} queries ran
          &nbsp;|&nbsp;{syncResult.rawPlacesFound} raw places found
          &nbsp;|&nbsp;<strong>{syncResult.companiesSaved} saved</strong>
          &nbsp;({syncResult.inserted} new, {syncResult.updated} updated)
          {syncResult.stoppedEarly && <span className="mgc-warn"> ⚠ Stopped early</span>}
          {syncResult.errors.length > 0 && (
            <details>
              <summary>{syncResult.errors.length} errors</summary>
              <ul>{syncResult.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </details>
          )}
        </div>
      )}

      {/* ── Crawl Result ─────────────────────────────────────────────── */}
      {crawlResult && (
        <div className="mgc-result-box">
          <strong>Crawl complete</strong>
          &nbsp;|&nbsp;{crawlResult.totalCompaniesCrawled} companies crawled
          &nbsp;|&nbsp;<strong>{crawlResult.totalEmailsFoundThisRun} new emails</strong>
          &nbsp;|&nbsp;{crawlResult.totalDuplicatesSkipped} dups skipped
          {crawlResult.stoppedByLimit && <span className="mgc-warn"> ⚠ Stopped at limit</span>}
          {crawlResult.errors.length > 0 && (
            <details>
              <summary>{crawlResult.errors.length} errors</summary>
              <ul>{crawlResult.errors.slice(0, 20).map((e, i) => <li key={i}>{e}</li>)}</ul>
            </details>
          )}
        </div>
      )}

      {/* ── Filters ──────────────────────────────────────────────────── */}
      <div className="mgc-filters">
        <div className="mgc-filter-group">
          <label className="mgc-filter-label">COMPANY NAME</label>
          <input
            className="mgc-filter-input"
            placeholder="Search name…"
            value={filters.name}
            onChange={(e) => handleTextFilter("name", e.target.value)}
          />
        </div>
        <div className="mgc-filter-group">
          <label className="mgc-filter-label">DOMAIN</label>
          <input
            className="mgc-filter-input"
            placeholder="e.g. example.com"
            value={filters.domain}
            onChange={(e) => handleTextFilter("domain", e.target.value)}
          />
        </div>
        <div className="mgc-filter-group">
          <label className="mgc-filter-label">KEYWORD</label>
          <input
            className="mgc-filter-input"
            placeholder="e.g. architects"
            value={filters.keyword}
            onChange={(e) => handleTextFilter("keyword", e.target.value)}
          />
        </div>
        <div className="mgc-filter-group">
          <label className="mgc-filter-label">LOCATION</label>
          <input
            className="mgc-filter-input"
            placeholder="e.g. New York"
            value={filters.searchLocation}
            onChange={(e) => handleTextFilter("searchLocation", e.target.value)}
          />
        </div>
        <div className="mgc-filter-group">
          <label className="mgc-filter-label">CRAWL STATUS</label>
          <select
            className="mgc-filter-select"
            value={filters.crawlStatus}
            onChange={(e) => setFilters((f) => ({ ...f, crawlStatus: e.target.value }))}
          >
            <option value="">All</option>
            <option value="done">Done</option>
            <option value="done_no_emails">Done (no emails)</option>
            <option value="error">Error</option>
            <option value="blocked">Blocked</option>
          </select>
        </div>
        <div className="mgc-filter-group">
          <label className="mgc-filter-label">MIN EMAILS</label>
          <input
            className="mgc-filter-input"
            type="number"
            min={0}
            placeholder="0"
            value={filters.minEmailCount}
            onChange={(e) => setFilters((f) => ({ ...f, minEmailCount: e.target.value }))}
          />
        </div>
        <div className="mgc-filter-group mgc-filter-checkboxes">
          <label className="mgc-filter-label">SHOW</label>
          <label className="mgc-checkbox-label">
            <input
              type="checkbox"
              checked={filters.onlyWithWebsite}
              onChange={(e) => setFilters((f) => ({ ...f, onlyWithWebsite: e.target.checked }))}
            />
            &nbsp;WITH WEBSITE ONLY
          </label>
          <label className="mgc-checkbox-label">
            <input
              type="checkbox"
              checked={filters.onlyWithEmails}
              onChange={(e) => setFilters((f) => ({ ...f, onlyWithEmails: e.target.checked }))}
            />
            &nbsp;WITH EMAILS ONLY
          </label>
        </div>
      </div>

      {/* ── Table ────────────────────────────────────────────────────── */}
      {loading ? (
        <p className="mgc-loading">Loading…</p>
      ) : (
        <div className="mgc-table-wrap">
          <table className="mgc-table">
            <thead>
              <tr>
                {[
                  ["companyName",    "COMPANY NAME"],
                  ["domain",         "DOMAIN"],
                  ["city",           "CITY"],
                  ["state",          "STATE"],
                  ["keyword",        "KEYWORD"],
                  ["searchLocation", "LOCATION"],
                  ["emailCount",     "EMAILS"],
                  ["crawlStatus",    "CRAWL"],
                  ["lastSyncedAt",   "SYNCED"],
                  ["lastCrawledAt",  "CRAWLED"],
                ].map(([col, label]) => (
                  <th key={col} className="mgc-th" onClick={() => handleSort(col)}>
                    {label} {sortIcon(col)}
                  </th>
                ))}
                <th className="mgc-th">PHONE</th>
                <th className="mgc-th">WEBSITE</th>
                <th className="mgc-th">EMAILS FOUND</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={13} className="mgc-empty">
                    {total === 0 && !loading
                      ? "No companies yet — enter a keyword and location above, then click Search Companies."
                      : "No results match your filters."}
                  </td>
                </tr>
              ) : rows.map((row) => {
                const emails = row.emailsList
                  ? row.emailsList.split("|||").filter(Boolean)
                  : [];
                return (
                  <tr
                    key={row.id}
                    className="mgc-row"
                    onClick={() => setSelected(row)}
                  >
                    <td className="mgc-td mgc-td-name">{row.companyName ?? "—"}</td>
                    <td className="mgc-td mgc-td-domain">{row.domain ?? "—"}</td>
                    <td className="mgc-td">{row.city ?? "—"}</td>
                    <td className="mgc-td">{row.state ?? "—"}</td>
                    <td className="mgc-td">{row.keyword ?? "—"}</td>
                    <td className="mgc-td">{row.searchLocation ?? "—"}</td>
                    <td className="mgc-td mgc-td-center">
                      {emails.length > 0 ? (
                        <span className="mgc-email-count">{emails.length}</span>
                      ) : "—"}
                    </td>
                    <td className="mgc-td">{crawlStatusBadge(row.crawlStatus)}</td>
                    <td className="mgc-td mgc-td-date">{fmtDate(row.lastSyncedAt)}</td>
                    <td className="mgc-td mgc-td-date">{fmtDate(row.lastCrawledAt)}</td>
                    <td className="mgc-td">{row.phone ?? "—"}</td>
                    <td className="mgc-td">
                      {row.website
                        ? <a href={row.website} target="_blank" rel="noreferrer" className="mgc-link" onClick={(e) => e.stopPropagation()}>Visit</a>
                        : "—"}
                    </td>
                    <td className="mgc-td mgc-td-emails">
                      {emails.length > 0
                        ? emails.slice(0, 2).join(", ") + (emails.length > 2 ? `, +${emails.length - 2}` : "")
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Pagination ───────────────────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="mgc-pagination">
          <button className="mgc-page-btn" onClick={() => fetchRows(1)} disabled={page === 1}>«</button>
          <button className="mgc-page-btn" onClick={() => fetchRows(page - 1)} disabled={page === 1}>‹</button>
          <span className="mgc-page-info">Page {page} of {totalPages} ({total} total)</span>
          <button className="mgc-page-btn" onClick={() => fetchRows(page + 1)} disabled={page === totalPages}>›</button>
          <button className="mgc-page-btn" onClick={() => fetchRows(totalPages)} disabled={page === totalPages}>»</button>
        </div>
      )}

      {/* ── Detail Drawer ────────────────────────────────────────────── */}
      {selected && (
        <div className="mgc-drawer-overlay" onClick={() => setSelected(null)}>
          <div className="mgc-drawer" onClick={(e) => e.stopPropagation()}>
            <button className="mgc-drawer-close" onClick={() => setSelected(null)}>✕</button>
            <h2 className="mgc-drawer-title">{selected.companyName ?? "—"}</h2>
            <dl className="mgc-drawer-dl">
              <dt>Website</dt>
              <dd>{selected.website
                ? <a href={selected.website} target="_blank" rel="noreferrer" className="mgc-link">{selected.website}</a>
                : "—"}
              </dd>
              <dt>Domain</dt>     <dd>{selected.domain ?? "—"}</dd>
              <dt>Address</dt>    <dd>{selected.address ?? "—"}</dd>
              <dt>City / State</dt><dd>{[selected.city, selected.state].filter(Boolean).join(", ") || "—"}</dd>
              <dt>Phone</dt>       <dd>{selected.phone ?? "—"}</dd>
              <dt>Keyword</dt>    <dd>{selected.keyword ?? "—"}</dd>
              <dt>Location</dt>   <dd>{selected.searchLocation ?? "—"}</dd>
              <dt>Crawl Status</dt><dd>{crawlStatusBadge(selected.crawlStatus)}</dd>
              <dt>Pages Crawled</dt><dd>{selected.pagesCrawled ?? "—"}</dd>
              <dt>Last Synced</dt><dd>{fmtDate(selected.lastSyncedAt)}</dd>
              <dt>Last Crawled</dt><dd>{fmtDate(selected.lastCrawledAt)}</dd>
            </dl>
            {selected.emailsList && (
              <>
                <h3 className="mgc-drawer-emails-title">Emails Found</h3>
                <ul className="mgc-drawer-emails">
                  {selected.emailsList.split("|||").filter(Boolean).map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </>
            )}
            {selected.crawlError && (
              <div className="mgc-drawer-error">
                <strong>Crawl Error:</strong> {selected.crawlError}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

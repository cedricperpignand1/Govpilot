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
  googlePlaceId: string | null;
  source: string | null;
  lastSyncedAt: string | null;
  // crawl fields
  emailCount: number | null;
  emailsList: string | null;
  crawlStatus: string | null;
  crawlError: string | null;
  pagesCrawled: number | null;
  lastCrawledAt: string | null;
  hasContactPage: number | null;
  hasAboutPage: number | null;
  crawlPayload: string | null;
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
  queriesTotal: number;
  queriesExecuted: number;
  queriesFailed: number;
  rawPlacesFound: number;
  dupsRemovedByPlaceId: number;
  filteredOutIrrelevant: number;
  uniquePlacesToProcess: number;
  skippedAlreadyInDb: number;
  skippedDomainDuplicate: number;
  skippedNoWebsite: number;
  companiesWithWebsite: number;
  domainsExtracted: number;
  companiesSaved: number;
  inserted: number;
  updated: number;
  failed: number;
  errors: string[];
  stoppedEarly: boolean;
}

interface CrawlRunStats {
  totalCompaniesConsidered: number;
  skippedNoWebsite: number;
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

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function crawlStatusBadge(status: string | null) {
  if (!status) return <span className="mgc-badge mgc-badge-none">—</span>;
  const map: Record<string, string> = {
    done:    "mgc-badge-done",
    noemail: "mgc-badge-noemail",
    error:   "mgc-badge-error",
    blocked: "mgc-badge-blocked",
  };
  return (
    <span className={`mgc-badge ${map[status] ?? "mgc-badge-none"}`}>
      {status}
    </span>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MiamiCompanies() {
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
    name: "", domain: "", city: "Miami",
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

  // ── Fetch ─────────────────────────────────────────────────────────────────

  const fetchRows = useCallback(async (p = 1) => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      if (debounced.name)   sp.set("name",   debounced.name);
      if (debounced.domain) sp.set("domain", debounced.domain);
      if (debounced.city || filters.city) sp.set("city", debounced.city ?? filters.city);
      if (filters.onlyWithWebsite) sp.set("onlyWithWebsite", "true");
      if (filters.onlyWithEmails)  sp.set("onlyWithEmails",  "true");
      if (filters.crawlStatus)     sp.set("crawlStatus", filters.crawlStatus);
      if (filters.minEmailCount)   sp.set("minEmailCount", filters.minEmailCount);
      sp.set("sortBy",   sortBy);
      sp.set("sortDir",  sortDir);
      sp.set("page",     String(p));
      sp.set("pageSize", String(PAGE_SIZE));

      const res  = await fetch(`/api/miami-companies?${sp}`);
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
  }, [debounced, filters.city, filters.onlyWithWebsite, filters.onlyWithEmails,
      filters.crawlStatus, filters.minEmailCount, sortBy, sortDir]);

  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetch("/api/miami-companies?summary=true");
      if (res.ok) setSummary(await res.json());
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchRows(1); }, [fetchRows]);
  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  // ── Sync ──────────────────────────────────────────────────────────────────

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    setError(null);
    try {
      const res  = await fetch("/api/miami-companies/sync", { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? `HTTP ${res.status}`);
      setSyncResult(json.stats);
      await fetchRows(1);
      await fetchSummary();
    } catch (err) {
      setError(String(err));
    } finally {
      setSyncing(false);
    }
  };

  // ── Crawl Emails ──────────────────────────────────────────────────────────

  const handleCrawl = async () => {
    setCrawling(true);
    setCrawlResult(null);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        maxPagesPerSite: crawlOptions.maxPagesPerSite,
        onlyWithoutEmails: crawlOptions.onlyWithoutEmails,
        skipRecentlyCrawledDays: crawlOptions.skipRecentlyCrawledDays,
        emailLimit: crawlOptions.emailLimitMode === "limited" ? crawlOptions.emailLimit : null,
      };
      const res  = await fetch("/api/miami-companies/crawl-emails", {
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

  // ── Export ────────────────────────────────────────────────────────────────

  const handleExport = async () => {
    setExporting(true);
    try {
      const sp = new URLSearchParams();
      if (debounced.name)   sp.set("name",   debounced.name ?? "");
      if (debounced.domain) sp.set("domain", debounced.domain ?? "");
      if (debounced.city || filters.city) sp.set("city", debounced.city ?? filters.city);
      if (filters.onlyWithWebsite) sp.set("onlyWithWebsite", "true");
      if (filters.onlyWithEmails)  sp.set("onlyWithEmails",  "true");
      if (filters.crawlStatus)     sp.set("crawlStatus", filters.crawlStatus);

      const res = await fetch(`/api/miami-companies/export?${sp}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "miami-companies.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(String(err));
    } finally {
      setExporting(false);
    }
  };

  // ── Sort ──────────────────────────────────────────────────────────────────

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

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="mgc-page">

      {/* ── Summary Cards ───────────────────────────────────────────── */}
      <div className="mgc-cards mgc-cards-7">
        {([
          ["Total Companies",    summary?.total               ?? "—"],
          ["With Website",       summary?.withWebsite         ?? "—"],
          ["Domains Extracted",  summary?.withDomain          ?? "—"],
          ["With Emails",        summary?.withEmails          ?? "—"],
          ["Total Emails Found", summary?.totalEmailsFound    ?? "—"],
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

      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <div className="mgc-toolbar">
        <button className="mgc-btn mgc-btn-primary" onClick={handleSync} disabled={syncing || crawling}>
          {syncing ? "Syncing…" : "Sync Miami Companies"}
        </button>
        <button className="mgc-btn mgc-btn-crawl" onClick={handleCrawl} disabled={crawling || syncing}>
          {crawling ? "Crawling emails…" : "Crawl Emails"}
        </button>
        <button className="mgc-btn mgc-btn-secondary" onClick={() => setShowCrawlControls((v) => !v)}>
          {showCrawlControls ? "Hide Crawl Options" : "Crawl Options"}
        </button>
        <button className="mgc-btn mgc-btn-secondary" onClick={() => fetchRows(page)} disabled={loading}>
          Refresh
        </button>
        <button className="mgc-btn mgc-btn-export" onClick={handleExport} disabled={exporting || total === 0}>
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
        {total > 0 && (
          <span className="mgc-count">{total.toLocaleString()} companies</span>
        )}
      </div>

      {/* ── Crawl Controls Panel ────────────────────────────────────── */}
      {showCrawlControls && (
        <div className="mgc-crawl-panel">
          <div className="mgc-crawl-title">Email Crawl Options</div>
          <div className="mgc-crawl-body">

            <div className="mgc-crawl-group">
              <div className="mgc-crawl-label">Email Limit</div>
              <label className="mgc-radio">
                <input type="radio" name="emailLimitMode" value="unlimited"
                  checked={crawlOptions.emailLimitMode === "unlimited"}
                  onChange={() => setCrawlOptions((o) => ({ ...o, emailLimitMode: "unlimited" }))} />
                Unlimited — crawl all companies
              </label>
              <label className="mgc-radio">
                <input type="radio" name="emailLimitMode" value="limited"
                  checked={crawlOptions.emailLimitMode === "limited"}
                  onChange={() => setCrawlOptions((o) => ({ ...o, emailLimitMode: "limited" }))} />
                Stop after
                <input
                  type="number"
                  className="mgc-num-input"
                  min={1}
                  value={crawlOptions.emailLimit}
                  disabled={crawlOptions.emailLimitMode !== "limited"}
                  onChange={(e) => setCrawlOptions((o) => ({ ...o, emailLimit: Number(e.target.value) }))}
                />
                new emails found
              </label>
              <div className="mgc-crawl-hint">
                "Limited" counts only newly inserted emails this run. Pre-existing emails don't count toward the limit.
              </div>
            </div>

            <div className="mgc-crawl-group">
              <div className="mgc-crawl-label">Max Pages Per Site</div>
              <input
                type="number"
                className="mgc-num-input"
                min={1} max={20}
                value={crawlOptions.maxPagesPerSite}
                onChange={(e) => setCrawlOptions((o) => ({ ...o, maxPagesPerSite: Number(e.target.value) }))}
              />
              <div className="mgc-crawl-hint">Pages crawled per company (homepage + contact/about pages). Default: 6.</div>
            </div>

            <div className="mgc-crawl-group">
              <div className="mgc-crawl-label">Skip Recently Crawled</div>
              <input
                type="number"
                className="mgc-num-input"
                min={0}
                value={crawlOptions.skipRecentlyCrawledDays}
                onChange={(e) => setCrawlOptions((o) => ({ ...o, skipRecentlyCrawledDays: Number(e.target.value) }))}
              />
              <div className="mgc-crawl-hint">Skip companies crawled within the last N days. Set 0 to re-crawl all.</div>
            </div>

            <div className="mgc-crawl-group">
              <label className="mgc-radio">
                <input
                  type="checkbox"
                  checked={crawlOptions.onlyWithoutEmails}
                  onChange={(e) => setCrawlOptions((o) => ({ ...o, onlyWithoutEmails: e.target.checked }))}
                />
                Only crawl companies with no emails yet
              </label>
            </div>

          </div>
        </div>
      )}

      {/* ── Sync result ─────────────────────────────────────────────── */}
      {syncResult && (
        <div className={`mgc-banner ${syncResult.stoppedEarly ? "mgc-banner-warn" : "mgc-banner-ok"}`}>
          {syncResult.stoppedEarly && (
            <div className="mgc-banner-title">Sync stopped early — API quota or auth error.</div>
          )}
          <strong>Sync complete</strong>
          <div className="mgc-stat-grid">
            {[
              ["Queries", `${syncResult.queriesExecuted}/${syncResult.queriesTotal} run${syncResult.queriesFailed > 0 ? `, ${syncResult.queriesFailed} failed` : ""}`],
              ["Raw places",      syncResult.rawPlacesFound.toLocaleString()],
              ["Deduped",         syncResult.dupsRemovedByPlaceId.toLocaleString()],
              ["Filtered out",    syncResult.filteredOutIrrelevant.toLocaleString()],
              ["No website",      syncResult.skippedNoWebsite.toLocaleString()],
              ["Domain dup",      syncResult.skippedDomainDuplicate.toLocaleString()],
              ["Domains",         syncResult.domainsExtracted.toLocaleString()],
              ["Saved",           `${syncResult.companiesSaved} (${syncResult.inserted} new · ${syncResult.updated} updated)`],
            ].map(([label, val]) => (
              <div key={label} className="mgc-stat-block">
                <span className="mgc-stat-label">{label}</span>
                <span className="mgc-stat-val">{val}</span>
              </div>
            ))}
          </div>
          {syncResult.errors.length > 0 && (
            <details className="mgc-errors">
              <summary>{syncResult.errors.length} error(s)</summary>
              <ul>{syncResult.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </details>
          )}
        </div>
      )}

      {/* ── Crawl result ────────────────────────────────────────────── */}
      {crawlResult && (
        <div className={`mgc-banner ${crawlResult.stoppedByLimit ? "mgc-banner-info" : "mgc-banner-ok"}`}>
          {crawlResult.stoppedByLimit && (
            <div className="mgc-banner-title">
              Crawl stopped — email limit of {crawlResult.emailLimit?.toLocaleString()} reached.
            </div>
          )}
          <strong>Email crawl complete</strong>
          <div className="mgc-stat-grid">
            {[
              ["Considered",      crawlResult.totalCompaniesConsidered.toLocaleString()],
              ["No website",      crawlResult.skippedNoWebsite.toLocaleString()],
              ["Recently crawled",crawlResult.skippedRecentlyCrawled.toLocaleString()],
              ["Crawled",         crawlResult.totalCompaniesCrawled.toLocaleString()],
              ["Pages fetched",   crawlResult.totalPagesCrawled.toLocaleString()],
              ["New emails",      crawlResult.totalEmailsFoundThisRun.toLocaleString()],
              ["Duplicates skip", crawlResult.totalDuplicatesSkipped.toLocaleString()],
              ["Failed",          crawlResult.totalFailedCompanies.toLocaleString()],
            ].map(([label, val]) => (
              <div key={label} className="mgc-stat-block">
                <span className="mgc-stat-label">{label}</span>
                <span className="mgc-stat-val">{val}</span>
              </div>
            ))}
          </div>
          {crawlResult.errors.length > 0 && (
            <details className="mgc-errors">
              <summary>{crawlResult.errors.length} error(s)</summary>
              <ul>{crawlResult.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </details>
          )}
        </div>
      )}

      {error && <div className="mgc-error"><strong>Error:</strong> {error}</div>}

      {/* ── Filters ─────────────────────────────────────────────────── */}
      <div className="mgc-filters">
        <div className="mgc-fgroup">
          <label className="mgc-flabel">Company Name</label>
          <input className="mgc-input" type="text"
            value={filters.name}
            onChange={(e) => handleTextFilter("name", e.target.value)}
            placeholder="Search name…" />
        </div>
        <div className="mgc-fgroup">
          <label className="mgc-flabel">Domain</label>
          <input className="mgc-input" type="text"
            value={filters.domain}
            onChange={(e) => handleTextFilter("domain", e.target.value)}
            placeholder="e.g. example.com" />
        </div>
        <div className="mgc-fgroup" style={{ maxWidth: 120 }}>
          <label className="mgc-flabel">City</label>
          <input className="mgc-input" type="text"
            value={filters.city}
            onChange={(e) => handleTextFilter("city", e.target.value)}
            placeholder="Miami" />
        </div>
        <div className="mgc-fgroup" style={{ maxWidth: 140 }}>
          <label className="mgc-flabel">Crawl Status</label>
          <select className="mgc-input"
            value={filters.crawlStatus}
            onChange={(e) => setFilters((f) => ({ ...f, crawlStatus: e.target.value }))}>
            <option value="">All</option>
            <option value="done">Done</option>
            <option value="noemail">No email</option>
            <option value="error">Error</option>
            <option value="blocked">Blocked</option>
          </select>
        </div>
        <div className="mgc-fgroup" style={{ maxWidth: 100 }}>
          <label className="mgc-flabel">Min Emails</label>
          <input className="mgc-input" type="number" min={0}
            value={filters.minEmailCount}
            onChange={(e) => setFilters((f) => ({ ...f, minEmailCount: e.target.value }))}
            placeholder="0" />
        </div>
        <div className="mgc-fgroup mgc-fcheck">
          <label className="mgc-flabel">Show</label>
          <label className="mgc-check">
            <input type="checkbox"
              checked={filters.onlyWithWebsite}
              onChange={(e) => setFilters((f) => ({ ...f, onlyWithWebsite: e.target.checked }))} />
            With website only
          </label>
          <label className="mgc-check" style={{ marginTop: 4 }}>
            <input type="checkbox"
              checked={filters.onlyWithEmails}
              onChange={(e) => setFilters((f) => ({ ...f, onlyWithEmails: e.target.checked }))} />
            With emails only
          </label>
        </div>
      </div>

      {/* ── Table ───────────────────────────────────────────────────── */}
      {loading ? (
        <div className="mgc-state">Loading companies…</div>
      ) : rows.length === 0 && !error ? (
        <div className="mgc-state">
          {summary?.total === 0
            ? <>No companies yet. Click <strong>Sync Miami Companies</strong> to pull from Google Places.</>
            : "No results match your filters."}
        </div>
      ) : (
        <>
          <div className="mgc-table-wrap">
            <table className="mgc-table">
              <thead>
                <tr>
                  {[
                    ["companyName",  "Company Name"],
                    ["domain",       "Domain"],
                    ["city",         "City"],
                    ["state",        "State"],
                    ["emailCount",   "Emails"],
                    ["crawlStatus",  "Crawl"],
                    ["lastSyncedAt", "Synced"],
                    ["lastCrawledAt","Crawled"],
                  ].map(([col, label]) => (
                    <th key={col} className="mgc-th mgc-th-sort" onClick={() => handleSort(col)}>
                      {label} {sortIcon(col)}
                    </th>
                  ))}
                  <th className="mgc-th">Phone</th>
                  <th className="mgc-th">Website</th>
                  <th className="mgc-th">Emails Found</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const emails = row.emailsList
                    ? row.emailsList.split("|||").slice(0, 2)
                    : [];
                  const extra = (row.emailCount ?? 0) - emails.length;
                  return (
                    <tr key={row.id} className="mgc-tr" onClick={() => setSelected(row)}>
                      <td className="mgc-td mgc-td-name">{row.companyName ?? "—"}</td>
                      <td className="mgc-td mgc-td-mono">{row.domain ?? "—"}</td>
                      <td className="mgc-td">{row.city ?? "—"}</td>
                      <td className="mgc-td">{row.state ?? "—"}</td>
                      <td className="mgc-td">
                        {(row.emailCount ?? 0) > 0
                          ? <span className="mgc-email-count">{row.emailCount}</span>
                          : <span className="mgc-td-muted">—</span>}
                      </td>
                      <td className="mgc-td">{crawlStatusBadge(row.crawlStatus)}</td>
                      <td className="mgc-td">{fmtDate(row.lastSyncedAt)}</td>
                      <td className="mgc-td">{fmtDate(row.lastCrawledAt)}</td>
                      <td className="mgc-td">{row.phone ?? "—"}</td>
                      <td className="mgc-td">
                        {row.website
                          ? <a href={row.website} target="_blank" rel="noreferrer" className="mgc-link"
                               onClick={(e) => e.stopPropagation()}>Visit</a>
                          : "—"}
                      </td>
                      <td className="mgc-td">
                        {emails.length > 0 ? (
                          <div className="mgc-email-preview">
                            {emails.map((e) => (
                              <span key={e} className="mgc-email-addr">{e}</span>
                            ))}
                            {extra > 0 && <span className="mgc-email-more">+{extra} more</span>}
                          </div>
                        ) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mgc-pagination">
            <button className="mgc-page-btn" onClick={() => fetchRows(1)} disabled={page === 1}>«</button>
            <button className="mgc-page-btn" onClick={() => fetchRows(page - 1)} disabled={page === 1}>‹</button>
            <span className="mgc-page-info">Page {page} of {totalPages} ({total.toLocaleString()} total)</span>
            <button className="mgc-page-btn" onClick={() => fetchRows(page + 1)} disabled={page >= totalPages}>›</button>
            <button className="mgc-page-btn" onClick={() => fetchRows(totalPages)} disabled={page >= totalPages}>»</button>
          </div>
        </>
      )}

      {/* ── Detail Drawer ────────────────────────────────────────────── */}
      {selected && (
        <div className="mgc-overlay" onClick={() => setSelected(null)}>
          <div className="mgc-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="mgc-drawer-header">
              <h2 className="mgc-drawer-title">{selected.companyName ?? "Company Details"}</h2>
              <button className="mgc-drawer-close" onClick={() => setSelected(null)}>✕</button>
            </div>
            <div className="mgc-drawer-body">

              {/* Company Info */}
              <div className="mgc-dsection">
                <div className="mgc-dsection-title">Company Info</div>
                <table className="mgc-dtable">
                  <tbody>
                    {([
                      ["Company Name",    selected.companyName],
                      ["Website",        selected.website],
                      ["Domain",         selected.domain],
                      ["Address",        selected.address],
                      ["City",           selected.city],
                      ["State",          selected.state],
                      ["Google Place ID",selected.googlePlaceId],
                      ["Source",         selected.source],
                      ["Last Synced",    fmtDate(selected.lastSyncedAt)],
                    ] as [string, string | null][]).map(([label, val]) => (
                      <tr key={label}>
                        <th>{label}</th>
                        <td>
                          {label === "Website" && val
                            ? <a href={val} target="_blank" rel="noreferrer" className="mgc-link">{val}</a>
                            : (val ?? "—")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Email Crawl Results */}
              <div className="mgc-dsection">
                <div className="mgc-dsection-title">Email Crawl Results</div>
                <table className="mgc-dtable">
                  <tbody>
                    <tr><th>Status</th><td>{crawlStatusBadge(selected.crawlStatus)}</td></tr>
                    <tr><th>Last Crawled</th><td>{fmtDateTime(selected.lastCrawledAt)}</td></tr>
                    <tr><th>Pages Crawled</th><td>{selected.pagesCrawled ?? "—"}</td></tr>
                    <tr><th>Has Contact Page</th><td>{selected.hasContactPage ? "Yes" : (selected.lastCrawledAt ? "No" : "—")}</td></tr>
                    <tr><th>Has About Page</th><td>{selected.hasAboutPage ? "Yes" : (selected.lastCrawledAt ? "No" : "—")}</td></tr>
                    <tr><th>Phone</th><td>{selected.phone ?? "—"}</td></tr>
                    <tr><th>Email Count</th><td>{selected.emailCount ?? "—"}</td></tr>
                    {selected.crawlError && (
                      <tr><th>Error</th><td className="mgc-error-text">{selected.crawlError}</td></tr>
                    )}
                  </tbody>
                </table>

                {/* Email list */}
                {selected.emailsList && (
                  <div className="mgc-email-list">
                    {selected.emailsList.split("|||").map((email) => (
                      <div key={email} className="mgc-email-item">
                        <span className="mgc-email-addr">{email}</span>
                        <a href={`mailto:${email}`} className="mgc-link" onClick={(e) => e.stopPropagation()}>
                          Send
                        </a>
                      </div>
                    ))}
                  </div>
                )}

                {selected.lastCrawledAt && !selected.emailsList && (
                  <div className="mgc-drawer-note">No emails found on this website.</div>
                )}
                {!selected.lastCrawledAt && (
                  <div className="mgc-drawer-note">This company has not been crawled yet.</div>
                )}

                {/* Raw crawl payload */}
                {selected.crawlPayload && (
                  <details style={{ marginTop: 12 }}>
                    <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--text-muted)" }}>
                      Debug: raw crawl payload
                    </summary>
                    <pre className="mgc-raw">
                      {(() => {
                        try { return JSON.stringify(JSON.parse(selected.crawlPayload!), null, 2); }
                        catch { return selected.crawlPayload; }
                      })()}
                    </pre>
                  </details>
                )}
              </div>

            </div>
          </div>
        </div>
      )}

    </div>
  );
}

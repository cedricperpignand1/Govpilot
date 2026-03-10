"use client";

import { useState, useEffect, useCallback, useRef } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface EmailRow {
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
  exportable: number;
  suppressed: number;
  notes: string | null;
  rawPayload: string | null;
  lastEnrichedAt: string | null;
}

interface SummaryStats {
  totalWithDomain: number;
  totalEnriched: number;
  totalEmails: number;
  verifiedEmails: number;
  uniqueDomains: number;
  lastEnrichedAt: string | null;
}

interface SyncStats {
  totalCompanies: number;
  skippedMissingDomain: number;
  skippedRecentlyEnriched: number;
  domainsSubmitted: number;
  domainsEnriched: number;
  domainsWithEmails: number;
  domainsWithZeroEmails: number;
  emailsFound: number;
  inserted: number;
  updated: number;
  failed: number;
  errors: string[];
  zeroEmailDomains: string[];
  stoppedEarly: boolean;
}

interface Filters {
  companyName: string;
  domain: string;
  email: string;
  verificationStatus: string;
  minConfidence: string;
  department: string;
  onlyWithEmails: boolean;
  onlyExportable: boolean;
}

type SortDir = "asc" | "desc";

const VERIFICATION_OPTIONS = ["valid", "invalid", "accept_all", "webmail", "disposable", "unknown", "blocked"];
const PAGE_SIZE = 50;

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString(); } catch { return iso; }
}

function confidenceColor(c: number | null): string {
  if (c == null) return "";
  if (c >= 80) return "mce-conf-high";
  if (c >= 50) return "mce-conf-mid";
  return "mce-conf-low";
}

function verificationBadge(status: string | null) {
  if (!status) return null;
  const cls =
    status === "valid"       ? "mce-badge-valid" :
    status === "invalid"     ? "mce-badge-invalid" :
    status === "accept_all"  ? "mce-badge-accept" :
    "mce-badge-unknown";
  return <span className={`mce-badge ${cls}`}>{status}</span>;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MiamiContractorEmails() {
  const [rows, setRows]               = useState<EmailRow[]>([]);
  const [total, setTotal]             = useState(0);
  const [page, setPage]               = useState(1);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [syncing, setSyncing]         = useState(false);
  const [syncResult, setSyncResult]   = useState<SyncStats | null>(null);
  const [summary, setSummary]         = useState<SummaryStats | null>(null);
  const [selected, setSelected]       = useState<EmailRow | null>(null);
  const [rawExpanded, setRawExpanded] = useState(false);
  const [sortBy, setSortBy]           = useState("companyName");
  const [sortDir, setSortDir]         = useState<SortDir>("asc");
  const [exporting, setExporting]     = useState(false);
  const [patchLoading, setPatchLoading] = useState(false);

  const [filters, setFilters] = useState<Filters>({
    companyName: "", domain: "", email: "",
    verificationStatus: "", minConfidence: "",
    department: "", onlyWithEmails: false, onlyExportable: false,
  });

  // Debounce text searches
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debounced, setDebounced] = useState<Partial<Filters>>({});

  const handleTextFilter = (key: keyof Filters, val: string) => {
    setFilters((f) => ({ ...f, [key]: val }));
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebounced((d) => ({ ...d, [key]: val }));
    }, 350);
  };

  // ── Fetch rows ────────────────────────────────────────────────────────────

  const fetchRows = useCallback(async (p = 1) => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      if (debounced.companyName)     sp.set("companyName",        debounced.companyName);
      if (debounced.domain)          sp.set("domain",             debounced.domain);
      if (debounced.email)           sp.set("email",              debounced.email);
      if (filters.verificationStatus) sp.set("verificationStatus", filters.verificationStatus);
      if (filters.minConfidence)      sp.set("minConfidence",      filters.minConfidence);
      if (debounced.department)       sp.set("department",         debounced.department ?? "");
      if (filters.onlyWithEmails)     sp.set("onlyWithEmails",     "true");
      if (filters.onlyExportable)     sp.set("onlyExportable",     "true");
      sp.set("hideSuppressed", "true");
      sp.set("sortBy",   sortBy);
      sp.set("sortDir",  sortDir);
      sp.set("page",     String(p));
      sp.set("pageSize", String(PAGE_SIZE));

      const res  = await fetch(`/api/miami-contractor-emails?${sp}`);
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
  }, [debounced, filters.verificationStatus, filters.minConfidence, filters.onlyWithEmails, filters.onlyExportable, sortBy, sortDir]);

  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetch("/api/miami-contractor-emails?summary=true");
      if (res.ok) setSummary(await res.json());
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchRows(1); }, [fetchRows]);
  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  // ── Sync ─────────────────────────────────────────────────────────────────

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    setError(null);
    try {
      const res  = await fetch("/api/miami-contractor-emails/sync", { method: "POST" });
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

  // ── CSV Export ────────────────────────────────────────────────────────────

  const handleExport = async () => {
    setExporting(true);
    try {
      const sp = new URLSearchParams();
      if (debounced.companyName)      sp.set("companyName",        debounced.companyName);
      if (debounced.domain)           sp.set("domain",             debounced.domain ?? "");
      if (debounced.email)            sp.set("email",              debounced.email ?? "");
      if (filters.verificationStatus) sp.set("verificationStatus", filters.verificationStatus);
      if (filters.minConfidence)      sp.set("minConfidence",      filters.minConfidence);
      if (debounced.department)       sp.set("department",         debounced.department ?? "");

      const res = await fetch(`/api/miami-contractor-emails/export?${sp}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1]
                   ?? "miami-contractor-emails.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(String(err));
    } finally {
      setExporting(false);
    }
  };

  // ── Patch (suppress / exportable toggle) ─────────────────────────────────

  const handlePatch = async (id: number, patch: { suppressed?: number; exportable?: number; notes?: string }) => {
    setPatchLoading(true);
    try {
      await fetch("/api/miami-contractor-emails", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...patch }),
      });
      // Refresh drawer row and table
      setSelected((prev) => prev ? { ...prev, ...patch } : prev);
      fetchRows(page);
      fetchSummary();
    } finally {
      setPatchLoading(false);
    }
  };

  // ── Sort ──────────────────────────────────────────────────────────────────

  const handleSort = (col: string) => {
    if (sortBy === col) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortBy(col); setSortDir("asc"); }
  };

  const sortIcon = (col: string) => (
    <span className={`mce-sort-icon ${sortBy === col ? "active" : ""}`}>
      {sortBy === col ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
    </span>
  );

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="mce-page">

      {/* ── Summary Cards ───────────────────────────────────────────── */}
      <div className="mce-cards">
        {[
          ["Companies w/ Domain",   summary?.totalWithDomain ?? "—"],
          ["Domains Enriched",      summary?.totalEnriched   ?? "—"],
          ["Total Emails Found",    summary?.totalEmails     ?? "—"],
          ["Verified Emails",       summary?.verifiedEmails  ?? "—"],
          ["Unique Domains",        summary?.uniqueDomains   ?? "—"],
          ["Last Sync",             summary?.lastEnrichedAt ? fmtDate(summary.lastEnrichedAt) : "Never"],
        ].map(([label, val]) => (
          <div key={label as string} className="mce-card">
            <span className={`mce-card-value ${typeof val === "string" && val.includes("/") ? "mce-card-date" : ""}`}>
              {val}
            </span>
            <span className="mce-card-label">{label}</span>
          </div>
        ))}
      </div>

      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <div className="mce-toolbar">
        <button className="mce-btn mce-btn-primary" onClick={handleSync} disabled={syncing}>
          {syncing ? "Syncing with Hunter…" : "Sync Emails from Hunter"}
        </button>
        <button className="mce-btn mce-btn-secondary" onClick={() => fetchRows(page)} disabled={loading}>
          Refresh Results
        </button>
        <button className="mce-btn mce-btn-export" onClick={handleExport} disabled={exporting || total === 0}>
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
        {total > 0 && (
          <span className="mce-count">
            {total.toLocaleString()} record{total !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* ── Sync result ─────────────────────────────────────────────── */}
      {syncResult && (
        <div className={`mce-sync-result ${syncResult.stoppedEarly ? "mce-sync-warn" : ""}`}>
          {syncResult.stoppedEarly && (
            <div className="mce-sync-quota-warn">
              ⚠ Hunter quota exceeded — sync stopped early. Check your monthly Hunter plan limit.
            </div>
          )}
          <strong>Sync complete</strong>
          <div className="mce-sync-grid">
            <div className="mce-sync-stat">
              <span className="mce-sync-label">Companies processed</span>
              <span className="mce-sync-val">{syncResult.totalCompanies}</span>
            </div>
            <div className="mce-sync-stat">
              <span className="mce-sync-label">No domain (skipped)</span>
              <span className="mce-sync-val">{syncResult.skippedMissingDomain}</span>
            </div>
            <div className="mce-sync-stat">
              <span className="mce-sync-label">Recently cached (skipped)</span>
              <span className="mce-sync-val">{syncResult.skippedRecentlyEnriched}</span>
            </div>
            <div className="mce-sync-stat">
              <span className="mce-sync-label">Domains submitted to Hunter</span>
              <span className="mce-sync-val">{syncResult.domainsSubmitted ?? syncResult.domainsEnriched}</span>
            </div>
            <div className="mce-sync-stat">
              <span className="mce-sync-label">Domains with emails found</span>
              <span className="mce-sync-val">{syncResult.domainsWithEmails ?? "—"}</span>
            </div>
            <div className="mce-sync-stat">
              <span className="mce-sync-label">Domains with zero emails</span>
              <span className="mce-sync-val">{syncResult.domainsWithZeroEmails ?? "—"}</span>
            </div>
            <div className="mce-sync-stat">
              <span className="mce-sync-label">Total emails found</span>
              <span className="mce-sync-val">{syncResult.emailsFound}</span>
            </div>
            <div className="mce-sync-stat">
              <span className="mce-sync-label">Inserted / Updated</span>
              <span className="mce-sync-val">{syncResult.inserted} / {syncResult.updated}</span>
            </div>
            <div className="mce-sync-stat">
              <span className="mce-sync-label">Failed</span>
              <span className="mce-sync-val">{syncResult.failed}</span>
            </div>
          </div>
          {(syncResult.domainsWithZeroEmails ?? 0) > 0 && (syncResult.zeroEmailDomains?.length ?? 0) > 0 && (
            <details className="mce-sync-errors">
              <summary>
                {syncResult.domainsWithZeroEmails} domain{syncResult.domainsWithZeroEmails !== 1 ? "s" : ""} returned
                zero emails from Hunter (Hunter may not have indexed these sites yet)
              </summary>
              <ul>
                {syncResult.zeroEmailDomains.map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            </details>
          )}
          {syncResult.errors.length > 0 && (
            <details className="mce-sync-errors">
              <summary>{syncResult.errors.length} error(s)</summary>
              <ul>{syncResult.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </details>
          )}
        </div>
      )}

      {error && (
        <div className="mce-error"><strong>Error:</strong> {error}</div>
      )}

      {/* ── Filters ─────────────────────────────────────────────────── */}
      <div className="mce-filters">
        {[
          ["companyName", "Company Name",  "Search company…"],
          ["domain",      "Domain",        "e.g. example.com"],
          ["email",       "Email",         "Search email…"],
          ["department",  "Department",    "e.g. executive"],
        ].map(([key, label, placeholder]) => (
          <div key={key as string} className="mce-filter-group">
            <label className="mce-filter-label">{label}</label>
            <input
              className="mce-input"
              type="text"
              value={filters[key as keyof Filters] as string}
              onChange={(e) => handleTextFilter(key as keyof Filters, e.target.value)}
              placeholder={placeholder as string}
            />
          </div>
        ))}

        <div className="mce-filter-group">
          <label className="mce-filter-label">Verification</label>
          <select className="mce-input" value={filters.verificationStatus}
            onChange={(e) => setFilters((f) => ({ ...f, verificationStatus: e.target.value }))}>
            <option value="">All</option>
            {VERIFICATION_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div className="mce-filter-group" style={{ maxWidth: 110 }}>
          <label className="mce-filter-label">Min Confidence</label>
          <input
            className="mce-input"
            type="number"
            min={0}
            max={100}
            value={filters.minConfidence}
            onChange={(e) => setFilters((f) => ({ ...f, minConfidence: e.target.value }))}
            placeholder="0–100"
          />
        </div>

        <div className="mce-filter-group mce-filter-checks">
          <label className="mce-filter-label">Show</label>
          <label className="mce-check">
            <input type="checkbox" checked={filters.onlyWithEmails}
              onChange={(e) => setFilters((f) => ({ ...f, onlyWithEmails: e.target.checked }))} />
            Only records with emails
          </label>
          <label className="mce-check">
            <input type="checkbox" checked={filters.onlyExportable}
              onChange={(e) => setFilters((f) => ({ ...f, onlyExportable: e.target.checked }))} />
            Only exportable
          </label>
        </div>
      </div>

      {/* ── Table ───────────────────────────────────────────────────── */}
      {loading ? (
        <div className="mce-state">Loading emails…</div>
      ) : rows.length === 0 && !error ? (
        <div className="mce-state">
          {summary?.totalEmails === 0
            ? <>No emails yet. First sync Miami Contractors, then click <strong>Sync Emails from Hunter</strong>.</>
            : "No records match your current filters."}
        </div>
      ) : (
        <>
          <div className="mce-table-wrap">
            <table className="mce-table">
              <thead>
                <tr>
                  {[
                    ["companyName",        "Company"],
                    ["domain",             "Domain"],
                    ["email",              "Email"],
                    ["firstName",          "First"],
                    ["lastName",           "Last"],
                    ["position",           "Position"],
                    ["department",         "Dept"],
                    ["emailType",          "Type"],
                    ["verificationStatus", "Verified"],
                    ["confidence",         "Conf."],
                    ["lastEnrichedAt",     "Enriched"],
                  ].map(([col, label]) => (
                    <th key={col} className="mce-th mce-th-sort" onClick={() => handleSort(col)}>
                      {label} {sortIcon(col)}
                    </th>
                  ))}
                  <th className="mce-th">LinkedIn</th>
                  <th className="mce-th">Phone</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="mce-tr" onClick={() => { setSelected(row); setRawExpanded(false); }}>
                    <td className="mce-td mce-td-name">{row.companyName ?? "—"}</td>
                    <td className="mce-td mce-td-mono">{row.domain ?? "—"}</td>
                    <td className="mce-td mce-td-email">{row.email ?? "—"}</td>
                    <td className="mce-td">{row.firstName ?? "—"}</td>
                    <td className="mce-td">{row.lastName  ?? "—"}</td>
                    <td className="mce-td">{row.position  ?? "—"}</td>
                    <td className="mce-td">{row.department ?? "—"}</td>
                    <td className="mce-td">
                      {row.emailType && <span className="mce-type-tag">{row.emailType}</span>}
                    </td>
                    <td className="mce-td">{verificationBadge(row.verificationStatus)}</td>
                    <td className="mce-td">
                      {row.confidence != null
                        ? <span className={`mce-conf ${confidenceColor(row.confidence)}`}>{row.confidence}</span>
                        : "—"}
                    </td>
                    <td className="mce-td">{fmtDate(row.lastEnrichedAt)}</td>
                    <td className="mce-td">
                      {row.linkedinUrl
                        ? <a href={row.linkedinUrl} target="_blank" rel="noreferrer" className="mce-link"
                            onClick={(e) => e.stopPropagation()}>View</a>
                        : "—"}
                    </td>
                    <td className="mce-td mce-td-mono">{row.phone ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="mce-pagination">
            <button className="mce-page-btn" onClick={() => fetchRows(1)} disabled={page === 1}>«</button>
            <button className="mce-page-btn" onClick={() => fetchRows(page - 1)} disabled={page === 1}>‹</button>
            <span className="mce-page-info">Page {page} of {totalPages} ({total.toLocaleString()} total)</span>
            <button className="mce-page-btn" onClick={() => fetchRows(page + 1)} disabled={page >= totalPages}>›</button>
            <button className="mce-page-btn" onClick={() => fetchRows(totalPages)} disabled={page >= totalPages}>»</button>
          </div>
        </>
      )}

      {/* ── Detail Drawer ────────────────────────────────────────────── */}
      {selected && (
        <div className="mce-overlay" onClick={() => setSelected(null)}>
          <div className="mce-drawer" onClick={(e) => e.stopPropagation()}>

            <div className="mce-drawer-header">
              <div>
                <h2 className="mce-drawer-title">{selected.email ?? "Email Record"}</h2>
                <div className="mce-drawer-subtitle">{selected.companyName ?? selected.domain ?? ""}</div>
              </div>
              <button className="mce-drawer-close" onClick={() => setSelected(null)}>✕</button>
            </div>

            <div className="mce-drawer-body">

              {/* Status flags */}
              <section className="mce-section">
                <h3 className="mce-section-title">Status Flags</h3>
                <div className="mce-flags">
                  <div className="mce-flag-row">
                    <span className="mce-flag-label">Exportable</span>
                    <button
                      className={`mce-toggle ${selected.exportable ? "mce-toggle-on" : "mce-toggle-off"}`}
                      disabled={patchLoading}
                      onClick={() => handlePatch(selected.id, { exportable: selected.exportable ? 0 : 1 })}
                    >
                      {selected.exportable ? "Yes" : "No"}
                    </button>
                  </div>
                  <div className="mce-flag-row">
                    <span className="mce-flag-label">Suppressed (Do Not Contact)</span>
                    <button
                      className={`mce-toggle ${selected.suppressed ? "mce-toggle-on mce-toggle-suppressed" : "mce-toggle-off"}`}
                      disabled={patchLoading}
                      onClick={() => handlePatch(selected.id, { suppressed: selected.suppressed ? 0 : 1 })}
                    >
                      {selected.suppressed ? "Suppressed" : "Not Suppressed"}
                    </button>
                  </div>
                </div>
              </section>

              {/* Email details */}
              <section className="mce-section">
                <h3 className="mce-section-title">Email Details</h3>
                <table className="mce-dtable">
                  <tbody>
                    {([
                      ["Email",               selected.email],
                      ["First Name",          selected.firstName],
                      ["Last Name",           selected.lastName],
                      ["Position",            selected.position],
                      ["Department",          selected.department],
                      ["Email Type",          selected.emailType],
                      ["Verification Status", selected.verificationStatus],
                      ["Confidence",          selected.confidence != null ? `${selected.confidence}/100` : null],
                      ["Phone",               selected.phone],
                    ] as [string, string | number | null][]).map(([label, val]) => (
                      <tr key={label}>
                        <th>{label}</th>
                        <td>{val ?? "—"}</td>
                      </tr>
                    ))}
                    <tr>
                      <th>LinkedIn</th>
                      <td>
                        {selected.linkedinUrl
                          ? <a href={selected.linkedinUrl} target="_blank" rel="noreferrer" className="mce-link">{selected.linkedinUrl}</a>
                          : "—"}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </section>

              {/* Company reference */}
              <section className="mce-section">
                <h3 className="mce-section-title">Company Reference</h3>
                <table className="mce-dtable">
                  <tbody>
                    {([
                      ["Company Name",    selected.companyName],
                      ["Domain",         selected.domain],
                      ["Contractor ID",  selected.contractorId],
                      ["Source",         selected.source],
                      ["Last Enriched",  fmtDate(selected.lastEnrichedAt)],
                    ] as [string, string | number | null][]).map(([label, val]) => (
                      <tr key={label}>
                        <th>{label}</th>
                        <td>{val ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              {/* Notes */}
              <section className="mce-section">
                <h3 className="mce-section-title">Notes</h3>
                <textarea
                  className="mce-input mce-notes"
                  rows={3}
                  defaultValue={selected.notes ?? ""}
                  placeholder="Add private notes…"
                  onBlur={(e) => {
                    const val = e.target.value.trim();
                    if (val !== (selected.notes ?? "")) {
                      handlePatch(selected.id, { notes: val });
                    }
                  }}
                />
              </section>

              {/* Raw payload */}
              <section className="mce-section">
                <button className="mce-btn mce-btn-secondary mce-btn-sm"
                  onClick={() => setRawExpanded((v) => !v)}>
                  {rawExpanded ? "Hide Raw Hunter Payload" : "Show Raw Hunter Payload"}
                </button>
                {rawExpanded && selected.rawPayload && (
                  <pre className="mce-raw">
                    {JSON.stringify(JSON.parse(selected.rawPayload), null, 2)}
                  </pre>
                )}
              </section>

            </div>
          </div>
        </div>
      )}

    </div>
  );
}

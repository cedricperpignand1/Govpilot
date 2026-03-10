"use client";

import { useState, useEffect, useCallback, useRef } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Contractor {
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
  naicsCodes: string | null;
  businessTypes: string | null;
  registrationStatus: string | null;
  activationDate: string | null;
  expirationDate: string | null;
  website: string | null;
  phone: string | null;
  rawPayload: string | null;
  lastSyncedAt: string | null;
}

interface SummaryStats {
  total: number;
  uniqueZips: number;
  uniqueNaics: number;
  lastSyncedAt: string | null;
}

interface SyncStats {
  totalFetched: number;
  inserted: number;
  updated: number;
  failed: number;
  errors: string[];
}

interface Filters {
  city: string;
  state: string;
  name: string;
  naics: string;
  status: string;
}

type SortDir = "asc" | "desc";

const NAICS_OPTIONS = [
  { code: "236220", label: "236220 — Commercial Building Construction" },
  { code: "236210", label: "236210 — Industrial Building Construction" },
  { code: "237310", label: "237310 — Highway, Street, and Bridge Construction" },
  { code: "237110", label: "237110 — Water and Sewer Line Construction" },
  { code: "238220", label: "238220 — Plumbing, Heating, and Air-Conditioning" },
  { code: "238210", label: "238210 — Electrical Contractors" },
  { code: "238990", label: "238990 — All Other Specialty Trade Contractors" },
];

const STATUS_OPTIONS = ["Active", "Inactive", "Expired"];

const PAGE_SIZE = 50;

function parseJsonArr(json: string | null): string[] {
  if (!json) return [];
  try { return JSON.parse(json); } catch { return []; }
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString(); } catch { return iso; }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MiamiContractors() {
  const [rows, setRows]               = useState<Contractor[]>([]);
  const [total, setTotal]             = useState(0);
  const [page, setPage]               = useState(1);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [syncing, setSyncing]         = useState(false);
  const [syncResult, setSyncResult]   = useState<SyncStats | null>(null);
  const [summary, setSummary]         = useState<SummaryStats | null>(null);
  const [selected, setSelected]       = useState<Contractor | null>(null);
  const [rawExpanded, setRawExpanded] = useState(false);
  const [sortBy, setSortBy]           = useState("entityName");
  const [sortDir, setSortDir]         = useState<SortDir>("asc");
  const [exporting, setExporting]     = useState(false);

  const [filters, setFilters] = useState<Filters>({
    city: "Miami",
    state: "FL",
    name: "",
    naics: "",
    status: "",
  });

  // Debounce name search
  const nameDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedName, setDebouncedName] = useState("");

  const handleNameChange = (val: string) => {
    setFilters((f) => ({ ...f, name: val }));
    if (nameDebounceRef.current) clearTimeout(nameDebounceRef.current);
    nameDebounceRef.current = setTimeout(() => setDebouncedName(val), 350);
  };

  // ── Fetch rows ────────────────────────────────────────────────────────────

  const fetchRows = useCallback(async (p = 1) => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      if (filters.city)   sp.set("city",   filters.city);
      if (filters.state)  sp.set("state",  filters.state);
      if (debouncedName)  sp.set("name",   debouncedName);
      if (filters.naics)  sp.set("naics",  filters.naics);
      if (filters.status) sp.set("status", filters.status);
      sp.set("sortBy",   sortBy);
      sp.set("sortDir",  sortDir);
      sp.set("page",     String(p));
      sp.set("pageSize", String(PAGE_SIZE));

      const res  = await fetch(`/api/miami-contractors?${sp}`);
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
  }, [filters.city, filters.state, debouncedName, filters.naics, filters.status, sortBy, sortDir]);

  // ── Fetch summary stats ───────────────────────────────────────────────────

  const fetchSummary = useCallback(async () => {
    try {
      const res  = await fetch("/api/miami-contractors?summary=true");
      const json = await res.json();
      if (res.ok) setSummary(json);
    } catch { /* silent */ }
  }, []);

  // Re-query on filter/sort changes
  useEffect(() => { fetchRows(1); }, [fetchRows]);
  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  // ── Sync ─────────────────────────────────────────────────────────────────

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    setError(null);
    try {
      const res  = await fetch("/api/miami-contractors/sync", { method: "POST" });
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
      if (filters.city)   sp.set("city",   filters.city);
      if (filters.state)  sp.set("state",  filters.state);
      if (debouncedName)  sp.set("name",   debouncedName);
      if (filters.naics)  sp.set("naics",  filters.naics);
      if (filters.status) sp.set("status", filters.status);

      const res = await fetch(`/api/miami-contractors/export?${sp}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1]
                   ?? "miami-contractors.csv";
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
    if (sortBy === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(col);
      setSortDir("asc");
    }
  };

  const sortIcon = (col: string) => {
    if (sortBy !== col) return <span className="mc-sort-icon">↕</span>;
    return <span className="mc-sort-icon active">{sortDir === "asc" ? "↑" : "↓"}</span>;
  };

  // ── Pagination ────────────────────────────────────────────────────────────

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // ── NAICS multi-select toggle ─────────────────────────────────────────────

  const toggleNaics = (code: string) => {
    const current = filters.naics
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const next = current.includes(code)
      ? current.filter((c) => c !== code)
      : [...current, code];
    setFilters((f) => ({ ...f, naics: next.join(",") }));
  };

  const activeNaics = new Set(
    filters.naics.split(",").map((s) => s.trim()).filter(Boolean)
  );

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="mc-page">

      {/* ── Summary cards ─────────────────────────────────────────────── */}
      <div className="mc-cards">
        <div className="mc-card">
          <span className="mc-card-value">{summary?.total ?? "—"}</span>
          <span className="mc-card-label">Companies Loaded</span>
        </div>
        <div className="mc-card">
          <span className="mc-card-value">{summary?.uniqueZips ?? "—"}</span>
          <span className="mc-card-label">Unique ZIP Codes</span>
        </div>
        <div className="mc-card">
          <span className="mc-card-value">{summary?.uniqueNaics ?? "—"}</span>
          <span className="mc-card-label">Unique NAICS Codes</span>
        </div>
        <div className="mc-card">
          <span className="mc-card-value mc-card-date">
            {summary?.lastSyncedAt ? fmtDate(summary.lastSyncedAt) : "Never"}
          </span>
          <span className="mc-card-label">Last Sync</span>
        </div>
      </div>

      {/* ── Action buttons ────────────────────────────────────────────── */}
      <div className="mc-toolbar">
        <button
          className="mc-btn mc-btn-primary"
          onClick={handleSync}
          disabled={syncing}
        >
          {syncing ? "Syncing…" : "Sync Miami Contractors"}
        </button>
        <button
          className="mc-btn mc-btn-secondary"
          onClick={() => fetchRows(page)}
          disabled={loading}
        >
          Refresh Results
        </button>
        <button
          className="mc-btn mc-btn-export"
          onClick={handleExport}
          disabled={exporting || total === 0}
        >
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
        {total > 0 && (
          <span className="mc-count">
            {total.toLocaleString()} contractor{total !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* ── Sync result banner ────────────────────────────────────────── */}
      {syncResult && (
        <div className="mc-sync-result">
          <strong>Sync complete:</strong>{" "}
          {syncResult.totalFetched} fetched · {syncResult.inserted} inserted ·{" "}
          {syncResult.updated} updated · {syncResult.failed} failed
          {syncResult.errors.length > 0 && (
            <details className="mc-sync-errors">
              <summary>{syncResult.errors.length} error(s)</summary>
              <ul>
                {syncResult.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* ── Error ─────────────────────────────────────────────────────── */}
      {error && (
        <div className="mc-error">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* ── Filters ───────────────────────────────────────────────────── */}
      <div className="mc-filters">
        <div className="mc-filter-group">
          <label className="mc-filter-label">City</label>
          <input
            className="mc-input"
            type="text"
            value={filters.city}
            onChange={(e) => setFilters((f) => ({ ...f, city: e.target.value }))}
            placeholder="Miami"
          />
        </div>

        <div className="mc-filter-group">
          <label className="mc-filter-label">State</label>
          <input
            className="mc-input"
            type="text"
            value={filters.state}
            onChange={(e) => setFilters((f) => ({ ...f, state: e.target.value }))}
            placeholder="FL"
            style={{ width: 60 }}
          />
        </div>

        <div className="mc-filter-group" style={{ flex: 2 }}>
          <label className="mc-filter-label">Company Name</label>
          <input
            className="mc-input"
            type="text"
            value={filters.name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="Search by name…"
          />
        </div>

        <div className="mc-filter-group">
          <label className="mc-filter-label">Status</label>
          <select
            className="mc-input"
            value={filters.status}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
          >
            <option value="">All</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <div className="mc-filter-group mc-filter-naics">
          <label className="mc-filter-label">NAICS Codes</label>
          <div className="mc-naics-grid">
            {NAICS_OPTIONS.map(({ code, label }) => (
              <label key={code} className="mc-naics-check">
                <input
                  type="checkbox"
                  checked={activeNaics.has(code)}
                  onChange={() => toggleNaics(code)}
                />
                {label}
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* ── Table ─────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="mc-state mc-state-loading">Loading contractors…</div>
      ) : rows.length === 0 && !error ? (
        <div className="mc-state mc-state-empty">
          {total === 0 && summary?.total === 0
            ? <>No contractors in the database yet. Click <strong>Sync Miami Contractors</strong> to pull data from SAM.gov.</>
            : "No results match your current filters."}
        </div>
      ) : (
        <>
          <div className="mc-table-wrap">
            <table className="mc-table">
              <thead>
                <tr>
                  {[
                    ["entityName",        "Company Name"],
                    ["uei",               "UEI"],
                    ["cageCode",          "CAGE"],
                    ["physicalAddressCity","City"],
                    ["physicalAddressState","St"],
                    ["physicalAddressZip", "ZIP"],
                    ["registrationStatus", "Status"],
                    ["activationDate",     "Activated"],
                    ["expirationDate",     "Expires"],
                  ].map(([col, label]) => (
                    <th
                      key={col}
                      className="mc-th mc-th-sortable"
                      onClick={() => handleSort(col)}
                    >
                      {label} {sortIcon(col)}
                    </th>
                  ))}
                  <th className="mc-th">NAICS</th>
                  <th className="mc-th">Business Types</th>
                  <th className="mc-th">Website</th>
                  <th className="mc-th">Phone</th>
                  <th className="mc-th">Last Synced</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="mc-tr"
                    onClick={() => { setSelected(row); setRawExpanded(false); }}
                  >
                    <td className="mc-td mc-td-name">
                      {row.entityName ?? row.legalBusinessName ?? "—"}
                    </td>
                    <td className="mc-td mc-td-mono">{row.uei ?? "—"}</td>
                    <td className="mc-td mc-td-mono">{row.cageCode ?? "—"}</td>
                    <td className="mc-td">{row.physicalAddressCity ?? "—"}</td>
                    <td className="mc-td">{row.physicalAddressState ?? "—"}</td>
                    <td className="mc-td mc-td-mono">{row.physicalAddressZip ?? "—"}</td>
                    <td className="mc-td">
                      <span className={`mc-status-badge mc-status-${(row.registrationStatus ?? "").toLowerCase().replace(/\s+/g, "-")}`}>
                        {row.registrationStatus ?? "—"}
                      </span>
                    </td>
                    <td className="mc-td">{fmtDate(row.activationDate)}</td>
                    <td className="mc-td">{fmtDate(row.expirationDate)}</td>
                    <td className="mc-td">
                      <div className="mc-naics-tags">
                        {parseJsonArr(row.naicsCodes).slice(0, 3).map((n) => (
                          <span key={n} className="mc-tag mc-naics-tag">{n}</span>
                        ))}
                        {parseJsonArr(row.naicsCodes).length > 3 && (
                          <span className="mc-tag mc-more-tag">+{parseJsonArr(row.naicsCodes).length - 3}</span>
                        )}
                      </div>
                    </td>
                    <td className="mc-td">
                      <div className="mc-naics-tags">
                        {parseJsonArr(row.businessTypes).slice(0, 2).map((b) => (
                          <span key={b} className="mc-tag mc-biz-tag">{b}</span>
                        ))}
                        {parseJsonArr(row.businessTypes).length > 2 && (
                          <span className="mc-tag mc-more-tag">+{parseJsonArr(row.businessTypes).length - 2}</span>
                        )}
                      </div>
                    </td>
                    <td className="mc-td">
                      {row.website
                        ? <a href={row.website} target="_blank" rel="noreferrer" className="mc-link" onClick={(e) => e.stopPropagation()}>Visit</a>
                        : "—"}
                    </td>
                    <td className="mc-td mc-td-mono">{row.phone ?? "—"}</td>
                    <td className="mc-td">{fmtDate(row.lastSyncedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="mc-pagination">
            <button
              className="mc-page-btn"
              onClick={() => fetchRows(1)}
              disabled={page === 1}
            >«</button>
            <button
              className="mc-page-btn"
              onClick={() => fetchRows(page - 1)}
              disabled={page === 1}
            >‹</button>
            <span className="mc-page-info">
              Page {page} of {totalPages} ({total.toLocaleString()} total)
            </span>
            <button
              className="mc-page-btn"
              onClick={() => fetchRows(page + 1)}
              disabled={page >= totalPages}
            >›</button>
            <button
              className="mc-page-btn"
              onClick={() => fetchRows(totalPages)}
              disabled={page >= totalPages}
            >»</button>
          </div>
        </>
      )}

      {/* ── Detail Drawer ──────────────────────────────────────────────── */}
      {selected && (
        <div className="mc-drawer-overlay" onClick={() => setSelected(null)}>
          <div className="mc-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="mc-drawer-header">
              <h2 className="mc-drawer-title">
                {selected.entityName ?? selected.legalBusinessName ?? "Company Details"}
              </h2>
              <button className="mc-drawer-close" onClick={() => setSelected(null)}>✕</button>
            </div>

            <div className="mc-drawer-body">
              {/* Core details */}
              <section className="mc-drawer-section">
                <h3 className="mc-drawer-section-title">Registration</h3>
                <table className="mc-detail-table">
                  <tbody>
                    {[
                      ["Legal Business Name", selected.legalBusinessName],
                      ["UEI",                 selected.uei],
                      ["CAGE Code",           selected.cageCode],
                      ["NCAGE Code",          selected.ncageCode],
                      ["Registration Status", selected.registrationStatus],
                      ["Activation Date",     fmtDate(selected.activationDate)],
                      ["Expiration Date",     fmtDate(selected.expirationDate)],
                    ].map(([label, val]) => (
                      <tr key={label as string}>
                        <th>{label}</th>
                        <td>{val ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <section className="mc-drawer-section">
                <h3 className="mc-drawer-section-title">Address</h3>
                <table className="mc-detail-table">
                  <tbody>
                    {[
                      ["Address",  selected.physicalAddressLine1],
                      ["City",     selected.physicalAddressCity],
                      ["State",    selected.physicalAddressState],
                      ["ZIP",      selected.physicalAddressZip],
                      ["Country",  selected.country],
                    ].map(([label, val]) => (
                      <tr key={label as string}>
                        <th>{label}</th>
                        <td>{val ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <section className="mc-drawer-section">
                <h3 className="mc-drawer-section-title">Contact</h3>
                <table className="mc-detail-table">
                  <tbody>
                    <tr>
                      <th>Phone</th>
                      <td>{selected.phone ?? "—"}</td>
                    </tr>
                    <tr>
                      <th>Website</th>
                      <td>
                        {selected.website
                          ? <a href={selected.website} target="_blank" rel="noreferrer" className="mc-link">{selected.website}</a>
                          : "—"}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </section>

              <section className="mc-drawer-section">
                <h3 className="mc-drawer-section-title">NAICS Codes</h3>
                <div className="mc-naics-tags mc-naics-tags-wrap">
                  {parseJsonArr(selected.naicsCodes).length > 0
                    ? parseJsonArr(selected.naicsCodes).map((n) => (
                        <span key={n} className="mc-tag mc-naics-tag">{n}</span>
                      ))
                    : <span className="mc-muted">None recorded</span>}
                </div>
              </section>

              <section className="mc-drawer-section">
                <h3 className="mc-drawer-section-title">Business Types</h3>
                <div className="mc-naics-tags mc-naics-tags-wrap">
                  {parseJsonArr(selected.businessTypes).length > 0
                    ? parseJsonArr(selected.businessTypes).map((b) => (
                        <span key={b} className="mc-tag mc-biz-tag">{b}</span>
                      ))
                    : <span className="mc-muted">None recorded</span>}
                </div>
              </section>

              {/* Raw JSON toggle */}
              <section className="mc-drawer-section">
                <button
                  className="mc-btn mc-btn-secondary mc-btn-sm"
                  onClick={() => setRawExpanded((v) => !v)}
                >
                  {rawExpanded ? "Hide Raw SAM Payload" : "Show Raw SAM Payload"}
                </button>
                {rawExpanded && selected.rawPayload && (
                  <pre className="mc-raw-json">
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

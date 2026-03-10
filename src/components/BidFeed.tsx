"use client";

import { useState, useCallback, useEffect } from "react";
import FilterPanel, { buildDefaultFilters } from "./FilterPanel";
import OpportunityRow from "./OpportunityRow";
import { FilterState, SamApiResponse, ScoredOpportunity } from "@/lib/types";
import { scoreAll } from "@/lib/scoring";

const LS_RESULTS_KEY = "govpilot_last_results";
const LS_META_KEY = "govpilot_last_meta";
const LS_TTL_MS = 4 * 60 * 60 * 1000; // keep localStorage results for 4 hours
const SEARCH_COOLDOWN_MS = 30 * 60 * 1000; // minimum 30 min between live API calls

interface StoredMeta {
  savedAt: number;
  total: number;
  filters: Partial<FilterState>;
}

function saveToLocalStorage(results: ScoredOpportunity[], total: number, filters: FilterState) {
  try {
    localStorage.setItem(LS_RESULTS_KEY, JSON.stringify(results));
    const meta: StoredMeta = { savedAt: Date.now(), total, filters };
    localStorage.setItem(LS_META_KEY, JSON.stringify(meta));
  } catch { /* quota exceeded — ignore */ }
}

function loadFromLocalStorage(): { results: ScoredOpportunity[]; total: number; meta: StoredMeta } | null {
  try {
    const raw = localStorage.getItem(LS_RESULTS_KEY);
    const rawMeta = localStorage.getItem(LS_META_KEY);
    if (!raw || !rawMeta) return null;
    const meta: StoredMeta = JSON.parse(rawMeta);
    if (Date.now() - meta.savedAt > LS_TTL_MS) return null; // expired
    return { results: JSON.parse(raw), total: meta.total, meta };
  } catch { return null; }
}

function sortOpportunities(
  opps: ScoredOpportunity[],
  sortBy: FilterState["sortBy"]
): ScoredOpportunity[] {
  const copy = [...opps];
  if (sortBy === "score") {
    return copy.sort((a, b) => b.score - a.score);
  }
  if (sortBy === "deadline") {
    return copy.sort((a, b) => {
      const da = new Date(a.responseDeadLine ?? a.reponseDeadLine ?? "9999").getTime();
      const db = new Date(b.responseDeadLine ?? b.reponseDeadLine ?? "9999").getTime();
      return da - db;
    });
  }
  return copy.sort((a, b) => {
    const da = new Date(a.postedDate ?? "0").getTime();
    const db = new Date(b.postedDate ?? "0").getTime();
    return db - da;
  });
}

export default function BidFeed() {
  const [filters, setFilters] = useState<FilterState>(buildDefaultFilters());
  const [results, setResults] = useState<ScoredOpportunity[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ msg: string; detail?: string; debugUrl?: string } | null>(null);
  const [searched, setSearched] = useState(false);
  const [fromCache, setFromCache] = useState<{ savedAt: number } | null>(null);

  // On mount, restore last results from localStorage so the page is useful
  // immediately without burning an API call
  useEffect(() => {
    const stored = loadFromLocalStorage();
    if (stored) {
      setResults(stored.results);
      setTotal(stored.total);
      setSearched(true);
      setFromCache({ savedAt: stored.meta.savedAt });
    }
  }, []);

  const handleSearch = useCallback(async () => {
    // Enforce cooldown: if a live search was done recently, serve from cache instead
    const stored = loadFromLocalStorage();
    if (stored && Date.now() - stored.meta.savedAt < SEARCH_COOLDOWN_MS) {
      const minsLeft = Math.ceil((SEARCH_COOLDOWN_MS - (Date.now() - stored.meta.savedAt)) / 60000);
      setResults(stored.results);
      setTotal(stored.total);
      setSearched(true);
      setFromCache({ savedAt: stored.meta.savedAt });
      setError({
        msg: `Using cached results to protect your SAM.gov quota. Next live search available in ~${minsLeft} min.`,
      });
      return;
    }

    setLoading(true);
    setError(null);
    setSearched(true);
    setFromCache(null);

    try {
      // ncode and ptype are NOT sent to SAM — the API rejects multiple values.
      // They are applied client-side below after we get results back.
      const sp = new URLSearchParams();
      sp.set("postedFrom", filters.postedFrom);
      sp.set("postedTo", filters.postedTo);
      if (filters.state) sp.set("state", filters.state);
      sp.set("limit", String(filters.limit));
      sp.set("offset", String(filters.offset));

      const res = await fetch(`/api/opportunities?${sp.toString()}`);
      const json = (await res.json()) as SamApiResponse & {
        error?: string;
        detail?: string;
        _debugUrl?: string;
      };

      if (!res.ok || json.error) {
        // On 429 rate limit, fall back to localStorage if available
        if (res.status === 429) {
          const stored = loadFromLocalStorage();
          if (stored) {
            setResults(stored.results);
            setTotal(stored.total);
            setFromCache({ savedAt: stored.meta.savedAt });
          }
          // Parse nextAccessTime from SAM response if present
          let nextAccess = "";
          try {
            const body = JSON.parse(json.detail ?? "{}");
            if (body.nextAccessTime) nextAccess = ` Resets at ${body.nextAccessTime}.`;
          } catch { /* ignore */ }
          setError({
            msg: `SAM.gov rate limit hit (429).${nextAccess} Showing last saved results below.`,
            detail: json.detail,
          });
        } else {
          setError({
            msg: json.error ?? `HTTP ${res.status}`,
            detail: json.detail,
            debugUrl: json._debugUrl,
          });
          setResults([]);
        }
        return;
      }

      const opps = json.opportunitiesData ?? [];
      const newTotal = json.totalRecords ?? opps.length;
      setTotal(newTotal);

      const includeKws = filters.includeKeywords
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const excludeKws = filters.excludeKeywords
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const now = Date.now();
      const active = opps.filter((o) => {
        const deadline = o.responseDeadLine ?? o.reponseDeadLine;
        if (!deadline) return true;
        return new Date(deadline).getTime() > now;
      });

      const scored = scoreAll(active, {
        includeKeywords: includeKws,
        excludeKeywords: excludeKws,
      });

      const sorted = sortOpportunities(scored, filters.sortBy);
      setResults(sorted);
      // Save to localStorage — survives page refresh + server restarts
      saveToLocalStorage(sorted, newTotal, filters);
    } catch (err) {
      setError({ msg: String(err) });
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const sorted = sortOpportunities(results, filters.sortBy);

  return (
    <div className="bid-feed">
      <FilterPanel
        filters={filters}
        onChange={setFilters}
        onSearch={handleSearch}
        loading={loading}
      />

      <div className="results-area">
        {error && (
          <div className={`error-box ${error.msg.includes("429") ? "error-box-warn" : ""}`}>
            <strong>{error.msg.includes("429") ? "Rate limit:" : "Error:"}</strong>{" "}
            {error.msg}
            {error.detail && !error.msg.includes("429") && (
              <pre className="error-detail">{error.detail}</pre>
            )}
            {error.debugUrl && (
              <div className="error-debug">
                <strong>URL sent to SAM:</strong>
                <code style={{ wordBreak: "break-all", display: "block", marginTop: 4 }}>
                  {error.debugUrl}
                </code>
              </div>
            )}
          </div>
        )}

        {fromCache && !loading && (
          <div className="cache-notice">
            Showing saved results from{" "}
            {new Date(fromCache.savedAt).toLocaleString()} — no API call made.
            Click <strong>Search SAM.gov</strong> to refresh when ready.
          </div>
        )}

        {!error && searched && !loading && !fromCache && (
          <div className="results-header">
            {sorted.length === 0
              ? "No results found."
              : `Showing ${sorted.length} of ${total ?? sorted.length} results`}
            {sorted.length > 0 && (
              <span className="results-sort-note">
                {" "}— sorted by{" "}
                {filters.sortBy === "score"
                  ? "best match"
                  : filters.sortBy === "deadline"
                  ? "soonest deadline"
                  : "newest posted"}
              </span>
            )}
          </div>
        )}

        {loading && (
          <div className="loading-state">Fetching from SAM.gov…</div>
        )}

        {!loading && sorted.map((opp) => (
          <OpportunityRow key={opp.noticeId} opp={opp} />
        ))}

        {!loading && !searched && (
          <div className="empty-state">
            Configure your filters above and click <strong>Search SAM.gov</strong> to load opportunities.
          </div>
        )}
      </div>
    </div>
  );
}

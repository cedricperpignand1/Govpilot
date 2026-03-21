"use client";

import { useState, useCallback, useEffect } from "react";
import FilterPanel from "./FilterPanel";
import OpportunityRow from "./OpportunityRow";
import { FilterState, SamApiResponse, ScoredOpportunity } from "@/lib/types";
import { scoreAll } from "@/lib/scoring";
import { useSavedOpportunities } from "@/lib/useSavedOpportunities";
import {
  daysAgo,
  todayForSam,
  SAAS_NAICS,
  SAAS_INCLUDE_KEYWORDS,
  SAAS_EXCLUDE_KEYWORDS,
} from "@/lib/defaults";

const LS_RESULTS_KEY = "govpilot_saas_results";
const LS_META_KEY = "govpilot_saas_meta";
const LS_TTL_MS = 4 * 60 * 60 * 1000;

interface StoredMeta {
  savedAt: number;
  total: number;
  filters: Partial<FilterState>;
}

function buildSaasFilters(): FilterState {
  return {
    postedFrom: daysAgo(30),
    postedTo: todayForSam(),
    keyword: "",
    solnum: "",
    agency: "",
    state: "",
    naics: SAAS_NAICS.join(", "),
    ptype: "o,k",
    includeKeywords: SAAS_INCLUDE_KEYWORDS,
    excludeKeywords: SAAS_EXCLUDE_KEYWORDS,
    sortBy: "score",
    minScore: 30,
    hideVeryHighCompetition: true,
    limit: 100,
    offset: 0,
  };
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
    if (Date.now() - meta.savedAt > LS_TTL_MS) return null;
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

export default function SaasOpsFeed() {
  const [filters, setFilters] = useState<FilterState>(buildSaasFilters());
  const [results, setResults] = useState<ScoredOpportunity[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ msg: string; detail?: string; debugUrl?: string } | null>(null);
  const [searched, setSearched] = useState(false);
  const [fromCache, setFromCache] = useState<{ savedAt: number } | null>(null);
  const [filteredOut, setFilteredOut] = useState(0);
  const [showSaved, setShowSaved] = useState(false);
  const { saved, toggle, isSaved } = useSavedOpportunities();

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
    setLoading(true);
    setError(null);
    setSearched(true);
    setFromCache(null);

    try {
      const sp = new URLSearchParams();
      sp.set("postedFrom", filters.postedFrom);
      sp.set("postedTo", filters.postedTo);
      if (filters.keyword.trim()) sp.set("title", filters.keyword.trim());
      if (filters.solnum.trim()) sp.set("solnum", filters.solnum.trim());
      if (filters.agency.trim()) sp.set("organizationName", filters.agency.trim());
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
        if (res.status === 429) {
          const stored = loadFromLocalStorage();
          if (stored) {
            setResults(stored.results);
            setTotal(stored.total);
            setFromCache({ savedAt: stored.meta.savedAt });
          }
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

      const filtered = scored.filter((o) => {
        if (o.score < filters.minScore) return false;
        if (filters.hideVeryHighCompetition && o.competitionTier === "Very High") return false;
        return true;
      });
      setFilteredOut(scored.length - filtered.length);

      const sorted = sortOpportunities(filtered, filters.sortBy);
      setResults(sorted);
      saveToLocalStorage(sorted, newTotal, filters);
    } catch (err) {
      setError({ msg: String(err) });
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const sorted = sortOpportunities(results, filters.sortBy);
  const displayRows = showSaved ? saved : sorted;

  return (
    <div className="bid-feed">
      <FilterPanel
        filters={filters}
        onChange={setFilters}
        onSearch={handleSearch}
        loading={loading}
      />

      <div className="results-area">
        {/* Saved toggle button */}
        <div className="saved-toggle-bar">
          <button
            className={`saved-toggle-btn ${showSaved ? "saved-toggle-btn-active" : ""}`}
            onClick={() => setShowSaved((v) => !v)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill={showSaved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" style={{ marginRight: 6 }}>
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
            </svg>
            Saved{saved.length > 0 ? ` (${saved.length})` : ""}
          </button>
        </div>

        {showSaved && (
          <div className="results-header">
            {saved.length === 0
              ? "No saved opportunities. Click the bookmark icon on any result to save it."
              : `${saved.length} saved opportunit${saved.length === 1 ? "y" : "ies"} — expired ones are removed automatically`}
          </div>
        )}

        {!showSaved && error && (
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

        {!showSaved && fromCache && !loading && (
          <div className="cache-notice">
            Showing saved results from{" "}
            {new Date(fromCache.savedAt).toLocaleString()} — no API call made.
            Click <strong>Search SAM.gov</strong> to refresh when ready.
          </div>
        )}

        {!showSaved && !error && searched && !loading && !fromCache && (
          <div className="results-header">
            {sorted.length === 0
              ? "No quality results found."
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
            {filteredOut > 0 && (
              <span className="results-sort-note" style={{ color: "#888" }}>
                {" "}· {filteredOut} low-quality filtered out
              </span>
            )}
          </div>
        )}

        {!showSaved && loading && (
          <div className="loading-state">Fetching from SAM.gov…</div>
        )}

        {!loading && displayRows.map((opp) => (
          <OpportunityRow
            key={opp.noticeId}
            opp={opp}
            isSaved={isSaved(opp.noticeId)}
            onToggleSave={toggle}
          />
        ))}

        {!showSaved && !loading && !searched && (
          <div className="empty-state">
            Configure your filters above and click <strong>Search SAM.gov</strong> to load SaaS platform opportunities.
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { FilterState } from "@/lib/types";
import {
  daysAgo,
  todayForSam,
  DEFAULT_INCLUDE_KEYWORDS,
  DEFAULT_EXCLUDE_KEYWORDS,
  PREFERRED_NAICS,
} from "@/lib/defaults";

interface Props {
  filters: FilterState;
  onChange: (f: FilterState) => void;
  onSearch: () => void;
  loading: boolean;
}

const PTYPE_OPTIONS = [
  { code: "o", label: "Solicitation (o)" },
  { code: "k", label: "Combined Synopsis/Solicitation (k)" },
  { code: "p", label: "Presolicitation (p)" },
  { code: "r", label: "Sources Sought (r)" },
  { code: "s", label: "Special Notice (s)" },
  { code: "u", label: "Justification (u)" },
];

export function buildDefaultFilters(): FilterState {
  return {
    postedFrom: daysAgo(30),  // 30-day window = more results per call = fewer searches needed
    postedTo: todayForSam(),
    state: "",                // nationwide — no state restriction
    naics: PREFERRED_NAICS.join(", "),
    ptype: "o,k",
    includeKeywords: DEFAULT_INCLUDE_KEYWORDS,
    excludeKeywords: DEFAULT_EXCLUDE_KEYWORDS,
    sortBy: "score",
    limit: 100,
    offset: 0,
  };
}

export default function FilterPanel({ filters, onChange, onSearch, loading }: Props) {
  const set = <K extends keyof FilterState>(key: K, value: FilterState[K]) =>
    onChange({ ...filters, [key]: value });

  const togglePtype = (code: string) => {
    const current = filters.ptype
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const next = current.includes(code)
      ? current.filter((c) => c !== code)
      : [...current, code];
    set("ptype", next.join(","));
  };

  const activePtypes = new Set(
    filters.ptype.split(",").map((s) => s.trim()).filter(Boolean)
  );

  return (
    <div className="filter-panel">
      <h2 className="filter-title">Filters</h2>

      <div className="filter-row">
        <label>
          Posted From
          <input
            type="text"
            value={filters.postedFrom}
            onChange={(e) => set("postedFrom", e.target.value)}
            placeholder="MM/dd/yyyy"
          />
        </label>
        <label>
          Posted To
          <input
            type="text"
            value={filters.postedTo}
            onChange={(e) => set("postedTo", e.target.value)}
            placeholder="MM/dd/yyyy"
          />
        </label>
        <label>
          State
          <input
            type="text"
            value={filters.state}
            onChange={(e) => set("state", e.target.value)}
            placeholder="e.g. FL (blank = all)"
            style={{ width: 90 }}
          />
        </label>
        <label>
          Limit
          <input
            type="number"
            value={filters.limit}
            min={1}
            max={1000}
            onChange={(e) => set("limit", Number(e.target.value))}
            style={{ width: 70 }}
          />
        </label>
      </div>

      <div className="filter-row" style={{ alignItems: "flex-start" }}>
        <label style={{ flex: 1 }}>
          NAICS codes (comma-separated)
          <textarea
            value={filters.naics}
            onChange={(e) => set("naics", e.target.value)}
            rows={2}
          />
        </label>
      </div>

      <div className="filter-section">
        <span className="filter-label">Procurement type</span>
        <div className="ptype-grid">
          {PTYPE_OPTIONS.map(({ code, label }) => (
            <label key={code} className="ptype-check">
              <input
                type="checkbox"
                checked={activePtypes.has(code)}
                onChange={() => togglePtype(code)}
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      <div className="filter-row" style={{ alignItems: "flex-start" }}>
        <label style={{ flex: 1 }}>
          Include keywords (comma-separated, match title)
          <textarea
            value={filters.includeKeywords}
            onChange={(e) => set("includeKeywords", e.target.value)}
            rows={4}
          />
        </label>
      </div>

      <div className="filter-row" style={{ alignItems: "flex-start" }}>
        <label style={{ flex: 1 }}>
          Exclude keywords (comma-separated, penalize score)
          <textarea
            value={filters.excludeKeywords}
            onChange={(e) => set("excludeKeywords", e.target.value)}
            rows={3}
          />
        </label>
      </div>

      <div className="filter-row">
        <label>
          Sort by
          <select
            value={filters.sortBy}
            onChange={(e) =>
              set("sortBy", e.target.value as FilterState["sortBy"])
            }
          >
            <option value="score">Best match score</option>
            <option value="deadline">Soonest deadline</option>
            <option value="posted">Newest posted</option>
          </select>
        </label>
      </div>

      <button
        className="search-btn"
        onClick={onSearch}
        disabled={loading}
      >
        {loading ? "Searching…" : "Search SAM.gov"}
      </button>
    </div>
  );
}

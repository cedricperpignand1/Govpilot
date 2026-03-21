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

// MM/dd/yyyy ↔ YYYY-MM-DD converters for <input type="date">
function toHtmlDate(samDate: string): string {
  const [mm, dd, yyyy] = samDate.split("/");
  if (!mm || !dd || !yyyy) return "";
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}
function fromHtmlDate(htmlDate: string): string {
  const [yyyy, mm, dd] = htmlDate.split("-");
  if (!mm || !dd || !yyyy) return "";
  return `${mm}/${dd}/${yyyy}`;
}

export function buildDefaultFilters(): FilterState {
  return {
    postedFrom: daysAgo(30),
    postedTo: todayForSam(),
    keyword: "",
    solnum: "",
    agency: "",
    state: "",
    naics: PREFERRED_NAICS.join(", "),
    ptype: "o,k",
    includeKeywords: DEFAULT_INCLUDE_KEYWORDS,
    excludeKeywords: DEFAULT_EXCLUDE_KEYWORDS,
    sortBy: "score",
    minScore: 30,
    hideVeryHighCompetition: true,
    limit: 100,
    offset: 0,
  };
}

export default function FilterPanel({ filters, onChange, onSearch, loading }: Props) {
  const set = <K extends keyof FilterState>(key: K, value: FilterState[K]) =>
    onChange({ ...filters, [key]: value });

  const togglePtype = (code: string) => {
    const current = filters.ptype.split(",").map((s) => s.trim()).filter(Boolean);
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

      {/* ── Quick search row ── */}
      <div className="filter-row" style={{ alignItems: "flex-end" }}>
        <label style={{ flex: 2 }}>
          Keyword search
          <input
            type="text"
            value={filters.keyword}
            onChange={(e) => set("keyword", e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSearch()}
            placeholder="e.g. gloves, lumber, HVAC — searches title on SAM"
          />
        </label>
        <label style={{ flex: 1 }}>
          Solicitation #
          <input
            type="text"
            value={filters.solnum}
            onChange={(e) => set("solnum", e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSearch()}
            placeholder="exact sol. number"
          />
        </label>
        <label style={{ flex: 1.5 }}>
          Agency
          <input
            type="text"
            value={filters.agency}
            onChange={(e) => set("agency", e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSearch()}
            placeholder="e.g. Department of Defense"
          />
        </label>
      </div>

      {/* ── Date / state / limit row ── */}
      <div className="filter-row">
        <label>
          Posted From
          <input
            type="date"
            value={toHtmlDate(filters.postedFrom)}
            onChange={(e) => set("postedFrom", fromHtmlDate(e.target.value))}
          />
        </label>
        <label>
          Posted To
          <input
            type="date"
            value={toHtmlDate(filters.postedTo)}
            onChange={(e) => set("postedTo", fromHtmlDate(e.target.value))}
          />
        </label>
        <label>
          State
          <input
            type="text"
            value={filters.state}
            onChange={(e) => set("state", e.target.value)}
            placeholder="FL (blank = all)"
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

      {/* ── NAICS ── */}
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

      {/* ── Procurement type ── */}
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

      {/* ── Client-side keyword scoring ── */}
      <div className="filter-row" style={{ alignItems: "flex-start" }}>
        <label style={{ flex: 1 }}>
          Score boost keywords (comma-separated)
          <textarea
            value={filters.includeKeywords}
            onChange={(e) => set("includeKeywords", e.target.value)}
            rows={4}
          />
        </label>
      </div>

      <div className="filter-row" style={{ alignItems: "flex-start" }}>
        <label style={{ flex: 1 }}>
          Score penalty keywords (comma-separated)
          <textarea
            value={filters.excludeKeywords}
            onChange={(e) => set("excludeKeywords", e.target.value)}
            rows={3}
          />
        </label>
      </div>

      {/* ── Sort + Quality threshold ── */}
      <div className="filter-row" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
        <label>
          Sort by
          <select
            value={filters.sortBy}
            onChange={(e) => set("sortBy", e.target.value as FilterState["sortBy"])}
          >
            <option value="score">Best match score</option>
            <option value="deadline">Soonest deadline</option>
            <option value="posted">Newest posted</option>
          </select>
        </label>
        <label>
          Min score (0–100)
          <input
            type="number"
            value={filters.minScore}
            min={0}
            max={100}
            onChange={(e) => set("minScore", Number(e.target.value))}
            style={{ width: 70 }}
          />
        </label>
        <label className="ptype-check" style={{ marginBottom: 4 }}>
          <input
            type="checkbox"
            checked={filters.hideVeryHighCompetition}
            onChange={(e) => set("hideVeryHighCompetition", e.target.checked)}
          />
          Hide &ldquo;Very High&rdquo; competition (30+ bidders)
        </label>
      </div>

      <button className="search-btn" onClick={onSearch} disabled={loading}>
        {loading ? "Searching…" : "Search SAM.gov"}
      </button>
    </div>
  );
}

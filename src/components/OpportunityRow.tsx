"use client";

import Link from "next/link";
import { ScoredOpportunity } from "@/lib/types";

interface Props {
  opp: ScoredOpportunity;
  isSaved?: boolean;
  onToggleSave?: (opp: ScoredOpportunity) => void;
}

function deadlineLabel(opp: ScoredOpportunity): { text: string; urgent: boolean } {
  const raw = opp.responseDeadLine ?? opp.reponseDeadLine;
  if (!raw) return { text: "No deadline", urgent: false };
  const d = new Date(raw);
  if (isNaN(d.getTime())) return { text: raw, urgent: false };
  const hoursLeft = (d.getTime() - Date.now()) / 3_600_000;
  const formatted = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  if (hoursLeft < 0) return { text: `EXPIRED ${formatted}`, urgent: true };
  if (hoursLeft < 48) return { text: `URGENT: ${formatted}`, urgent: true };
  return { text: formatted, urgent: false };
}

// Step 7 — Score interpretation labels
function scoreLabel(score: number): string {
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Strong";
  if (score >= 60) return "Moderate";
  if (score >= 40) return "Low";
  return "Noise";
}

function scoreColor(score: number): string {
  if (score >= 75) return "#22c55e";
  if (score >= 60) return "#f59e0b";
  if (score >= 40) return "#94a3b8";
  return "#ef4444";
}

function tierColor(tier: ScoredOpportunity["competitionTier"]): string {
  switch (tier) {
    case "Excellent":  return "#22c55e";
    case "Good":       return "#86efac";
    case "Moderate":   return "#f59e0b";
    case "High":       return "#f97316";
    case "Very High":  return "#ef4444";
  }
}

export default function OpportunityRow({ opp, isSaved = false, onToggleSave }: Props) {
  const { text: deadlineText, urgent } = deadlineLabel(opp);
  const agency = opp.fullParentPathName ?? opp.organizationName ?? "Unknown Agency";
  const samLink = opp.uiLink ?? opp.description;
  const pop = opp.placeOfPerformance;
  const popStr = [pop?.state?.code, pop?.zip].filter(Boolean).join(" ");

  return (
    <div className="opp-row">
      {/* Score column */}
      <div className="opp-score" style={{ color: scoreColor(opp.score) }}>
        <span className="score-number">{opp.score}</span>
        <span className="score-label">{scoreLabel(opp.score)}</span>
      </div>

      {/* Main content */}
      <div className="opp-main">
        <Link href={`/opportunities/${opp.noticeId}`} className="opp-title">
          {opp.title}
        </Link>

        <div className="opp-meta">
          <span className="meta-tag type-tag">{opp.type ?? opp.baseType ?? "—"}</span>
          {opp.naicsCode && (
            <span className="meta-tag naics-tag">NAICS {opp.naicsCode}</span>
          )}
          {opp.setAside && (
            <span className="meta-tag setaside-tag">{opp.setAside}</span>
          )}
          {popStr && (
            <span className="meta-tag pop-tag">{popStr}</span>
          )}
          {/* Competition badge */}
          <span
            className="meta-tag competition-tag"
            style={{ color: tierColor(opp.competitionTier), borderColor: tierColor(opp.competitionTier) }}
          >
            ~{opp.estimatedBidders} · {opp.competitionTier}
          </span>
        </div>

        {/* Key signals row */}
        {opp.signals.length > 0 && (
          <div className="opp-signals">
            {opp.signals.slice(0, 4).map((s, i) => (
              <span key={i} className="signal-chip">{s}</span>
            ))}
          </div>
        )}

        <div className="opp-details">
          <span className="detail-item agency">{agency}</span>
          {opp.solicitationNumber && (
            <span className="detail-item">#{opp.solicitationNumber}</span>
          )}
          <span className="detail-item">
            Posted:{" "}
            {opp.postedDate
              ? new Date(opp.postedDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })
              : "—"}
          </span>
          <span className={`detail-item deadline ${urgent ? "deadline-urgent" : ""}`}>
            Due: {deadlineText}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="opp-actions">
        {samLink && (
          <a
            href={samLink}
            target="_blank"
            rel="noopener noreferrer"
            className="sam-link"
            onClick={(e) => e.stopPropagation()}
          >
            SAM.gov
          </a>
        )}
        <Link href={`/opportunities/${opp.noticeId}`} className="detail-link">
          Details
        </Link>
        {onToggleSave && (
          <button
            className={`save-btn ${isSaved ? "save-btn-active" : ""}`}
            onClick={(e) => { e.stopPropagation(); onToggleSave(opp); }}
            title={isSaved ? "Remove from saved" : "Save opportunity"}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill={isSaved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

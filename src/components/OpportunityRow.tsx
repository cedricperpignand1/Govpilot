"use client";

import Link from "next/link";
import { useState, useRef, useEffect } from "react";
import { ScoredOpportunity } from "@/lib/types";

interface Props {
  opp: ScoredOpportunity;
  isSaved?: boolean;
  onToggleSave?: (opp: ScoredOpportunity, savedBy?: string) => void;
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
  const [showPrompt, setShowPrompt] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showPrompt) inputRef.current?.focus();
  }, [showPrompt]);

  function handleSaveClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (isSaved) {
      onToggleSave?.(opp);
    } else {
      setShowPrompt(true);
    }
  }

  function confirmSave() {
    const raw = nameInput.trim();
    const normalized = raw
      ? raw.replace(/\b\w/g, (c) => c.toUpperCase())
      : undefined;
    onToggleSave?.(opp, normalized);
    setShowPrompt(false);
    setNameInput("");
  }
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
          <div style={{ position: "relative" }}>
            {opp._savedBy && isSaved && (
              <div style={{ fontSize: 10, color: "#94a3b8", textAlign: "center", marginBottom: 2, whiteSpace: "nowrap" }}>
                {opp._savedBy}
              </div>
            )}
            <button
              className={`save-btn ${isSaved ? "save-btn-active" : ""}`}
              onClick={handleSaveClick}
              title={isSaved ? "Remove from saved" : "Save opportunity"}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill={isSaved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
              </svg>
            </button>
            {showPrompt && (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: "absolute", right: 0, top: "100%", marginTop: 6, zIndex: 50,
                  background: "#1e293b", border: "1px solid rgba(255,255,255,0.15)",
                  borderRadius: 8, padding: "10px 12px", width: 200,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                }}
              >
                <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>Who is saving this?</div>
                <input
                  ref={inputRef}
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") confirmSave(); if (e.key === "Escape") { setShowPrompt(false); setNameInput(""); } }}
                  placeholder="Your name (optional)"
                  style={{
                    width: "100%", background: "#0f172a", border: "1px solid rgba(255,255,255,0.2)",
                    borderRadius: 4, color: "#f1f5f9", padding: "4px 8px", fontSize: 13, marginBottom: 8, boxSizing: "border-box",
                  }}
                />
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={confirmSave}
                    style={{
                      flex: 1, background: "#f59e0b", border: "none", borderRadius: 4,
                      color: "#0f172a", fontWeight: 600, fontSize: 12, padding: "4px 0", cursor: "pointer",
                    }}
                  >
                    Save
                  </button>
                  <button
                    onClick={() => { setShowPrompt(false); setNameInput(""); }}
                    style={{
                      flex: 1, background: "transparent", border: "1px solid rgba(255,255,255,0.2)",
                      borderRadius: 4, color: "#94a3b8", fontSize: 12, padding: "4px 0", cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

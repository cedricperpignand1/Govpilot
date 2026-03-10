"use client";

import Link from "next/link";
import { ScoredOpportunity } from "@/lib/types";

interface Props {
  opp: ScoredOpportunity;
}

function deadlineLabel(opp: ScoredOpportunity): {
  text: string;
  urgent: boolean;
} {
  const raw = opp.responseDeadLine ?? opp.reponseDeadLine;
  if (!raw) return { text: "No deadline", urgent: false };
  const d = new Date(raw);
  if (isNaN(d.getTime())) return { text: raw, urgent: false };
  const hoursLeft = (d.getTime() - Date.now()) / 3_600_000;
  const formatted = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  if (hoursLeft < 0) return { text: `EXPIRED ${formatted}`, urgent: true };
  if (hoursLeft < 48) return { text: `URGENT: ${formatted}`, urgent: true };
  return { text: formatted, urgent: false };
}

function scoreColor(score: number): string {
  if (score >= 15) return "#22c55e";
  if (score >= 5) return "#f59e0b";
  if (score < 0) return "#ef4444";
  return "#94a3b8";
}

export default function OpportunityRow({ opp }: Props) {
  const { text: deadlineText, urgent } = deadlineLabel(opp);
  const agency =
    opp.fullParentPathName ??
    opp.organizationName ??
    "Unknown Agency";
  const samLink = opp.uiLink ?? opp.description;
  const pop = opp.placeOfPerformance;
  const popStr = [pop?.state?.code, pop?.zip].filter(Boolean).join(" ");

  return (
    <div className="opp-row">
      <div className="opp-score" style={{ color: scoreColor(opp.score) }}>
        {opp.score > 0 ? `+${opp.score}` : opp.score}
      </div>

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
        </div>

        <div className="opp-details">
          <span className="detail-item agency">{agency}</span>
          {opp.solicitationNumber && (
            <span className="detail-item">#{opp.solicitationNumber}</span>
          )}
          <span className="detail-item">
            Posted:{" "}
            {opp.postedDate
              ? new Date(opp.postedDate).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })
              : "—"}
          </span>
          <span
            className={`detail-item deadline ${urgent ? "deadline-urgent" : ""}`}
          >
            Due: {deadlineText}
          </span>
        </div>
      </div>

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
      </div>
    </div>
  );
}

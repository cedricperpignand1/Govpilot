"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Opportunity, SamApiResponse, POC } from "@/lib/types";

interface Props {
  noticeId: string;
}

function formatDateDisplay(raw?: string): string {
  if (!raw) return "—";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}


function PocCard({ poc }: { poc: POC }) {
  return (
    <div className="poc-card">
      {poc.type && <span className="poc-type">{poc.type}</span>}
      {poc.fullName && <div className="poc-name">{poc.fullName}</div>}
      {poc.title && <div className="poc-title-text">{poc.title}</div>}
      {poc.email && (
        <div>
          <a href={`mailto:${poc.email}`}>{poc.email}</a>
        </div>
      )}
      {poc.phone && <div>{poc.phone}</div>}
      {poc.fax && <div>Fax: {poc.fax}</div>}
    </div>
  );
}

/** Check the list results already saved in localStorage before hitting the API */
function getFromLocalStorage(id: string): Opportunity | null {
  try {
    const raw = localStorage.getItem("govpilot_last_results");
    if (!raw) return null;
    const results: Opportunity[] = JSON.parse(raw);
    return results.find((r) => r.noticeId === id) ?? null;
  } catch { return null; }
}

interface ResourceLink {
  url: string;
  name: string;
}

export default function OpportunityDetail({ noticeId }: Props) {
  const [opp, setOpp] = useState<Opportunity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"api" | "local">("api");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [descHtml, setDescHtml] = useState<string | null>(null);
  const [extraLinks, setExtraLinks] = useState<string[]>([]);

  async function handleAiInvoice() {
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await fetch(`/api/opportunities/${encodeURIComponent(noticeId)}/invoice-ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(opp),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setAiError(json.error ?? `Error ${res.status}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const cd = res.headers.get("content-disposition") ?? "";
      const match = cd.match(/filename="([^"]+)"/);
      a.download = match?.[1] ?? "AI_Invoice.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setAiError(String(err));
    } finally {
      setAiLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      // 1. Try localStorage first — free, instant, no API call
      const local = getFromLocalStorage(noticeId);
      if (local) {
        if (!cancelled) {
          setOpp(local);
          setSource("local");
          setLoading(false);
        }
        return; // done — saved an API call
      }

      // 2. Not in local store — fetch from API (uses server-side 30-min cache)
      try {
        const res = await fetch(`/api/opportunities/${encodeURIComponent(noticeId)}`);
        const json = (await res.json()) as SamApiResponse & { error?: string };
        if (cancelled) return;
        if (!res.ok || json.error) {
          setError(json.error ?? `HTTP ${res.status}`);
          return;
        }
        const data = json.opportunitiesData?.[0] ?? null;
        if (!data) {
          setError("Notice not found. It may have been removed or the date window is too narrow.");
        } else {
          setOpp(data);
          setSource("api");
        }
      } catch (err) {
        if (!cancelled) setError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [noticeId]);

  // Fetch description HTML once we have the opportunity
  useEffect(() => {
    if (!opp?.description) return;
    let cancelled = false;
    fetch(`/api/description?url=${encodeURIComponent(opp.description)}`)
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled && j?.description) setDescHtml(j.description);
      })
      .catch(() => { /* silently skip if unavailable */ });
    return () => { cancelled = true; };
  }, [opp?.description]);

  // Always fetch fresh resource links from SAM — the cached opp may have empty resourceLinks
  useEffect(() => {
    if (!noticeId) return;
    let cancelled = false;
    fetch(`/api/opportunities/${encodeURIComponent(noticeId)}/resources`)
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled && Array.isArray(j?.resourceLinks)) {
          setExtraLinks(j.resourceLinks);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [noticeId]);

  if (loading) return <div className="loading-state">Loading notice…</div>;
  if (error)
    return (
      <div className="error-box">
        <strong>Error:</strong> {error}
        <div style={{ marginTop: 12 }}>
          <Link href="/" className="back-link">
            ← Back to Bid Feed
          </Link>
        </div>
      </div>
    );
  if (!opp) return null;

  const deadline = opp.responseDeadLine ?? opp.reponseDeadLine;
  const samPageLink = opp.uiLink ?? `https://sam.gov/opp/${opp.noticeId}/view`;
  const descProxy = opp.description
    ? `/api/description?url=${encodeURIComponent(opp.description)}`
    : null;

  // Merge resourceLinks from cached opp + fresh fetch (deduplicated)
  const allResourceUrls = Array.from(
    new Set([...(opp.resourceLinks ?? []), ...extraLinks])
  );
  const attachments: ResourceLink[] = allResourceUrls.map((url) => {
    try {
      const u = new URL(url);
      const raw = u.searchParams.get("fileName") ??
        u.pathname.split("/").pop() ??
        "Attachment";
      return { url, name: decodeURIComponent(raw) };
    } catch {
      return { url, name: "Attachment" };
    }
  });

  // Additional named links from the opportunity's links array
  const namedLinks: ResourceLink[] = (opp.links ?? [])
    .filter((l) => l.href && l.rel !== "self")
    .map((l) => ({ url: l.href!, name: l.rel ?? "Link" }));

  return (
    <div className="detail-page">
      <div className="detail-header">
        <Link href="/" className="back-link">
          ← Back to Bid Feed
        </Link>
        <div className="detail-actions">
          <a
            href={samPageLink}
            target="_blank"
            rel="noopener noreferrer"
            className="sam-link big"
          >
            Open on SAM.gov
          </a>
          <button
            onClick={handleAiInvoice}
            disabled={aiLoading}
            className="invoice-btn ai-invoice-btn"
          >
            {aiLoading ? "Generating AI Invoice…" : "Download AI Invoice (Excel)"}
          </button>
        </div>
      </div>
      {aiError && (
        <div className="error-box" style={{ margin: "0 0 12px" }}>
          <strong>AI Invoice error:</strong> {aiError}
        </div>
      )}

      <h1 className="detail-title">{opp.title}</h1>

      <div className="detail-grid">
        <div className="detail-section">
          <h2>Core Info</h2>
          <table className="info-table">
            <tbody>
              <tr>
                <th>Notice ID</th>
                <td>{opp.noticeId}</td>
              </tr>
              <tr>
                <th>Solicitation #</th>
                <td>{opp.solicitationNumber ?? "—"}</td>
              </tr>
              <tr>
                <th>Type</th>
                <td>{opp.type ?? opp.baseType ?? "—"}</td>
              </tr>
              <tr>
                <th>Agency</th>
                <td>{opp.fullParentPathName ?? opp.organizationName ?? "—"}</td>
              </tr>
              <tr>
                <th>Posted</th>
                <td>{formatDateDisplay(opp.postedDate)}</td>
              </tr>
              <tr>
                <th>Response Deadline</th>
                <td
                  className={
                    deadline &&
                    new Date(deadline).getTime() - Date.now() < 172_800_000
                      ? "deadline-urgent"
                      : ""
                  }
                >
                  {formatDateDisplay(deadline)}
                </td>
              </tr>
              <tr>
                <th>Set-Aside</th>
                <td>{opp.setAside ?? opp.setAsideCode ?? "—"}</td>
              </tr>
              <tr>
                <th>NAICS</th>
                <td>{opp.naicsCode ?? "—"}</td>
              </tr>
              <tr>
                <th>Classification</th>
                <td>{opp.classificationCode ?? "—"}</td>
              </tr>
              {opp.placeOfPerformance && (
                <tr>
                  <th>Place of Performance</th>
                  <td>
                    {[
                      opp.placeOfPerformance.city?.name,
                      opp.placeOfPerformance.state?.name ??
                        opp.placeOfPerformance.state?.code,
                      opp.placeOfPerformance.zip,
                    ]
                      .filter(Boolean)
                      .join(", ") || "—"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {opp.pointOfContact && opp.pointOfContact.length > 0 && (
          <div className="detail-section">
            <h2>Points of Contact</h2>
            <div className="poc-list">
              {opp.pointOfContact.map((poc, i) => (
                <PocCard key={i} poc={poc} />
              ))}
            </div>
          </div>
        )}
      </div>

      {descHtml && (
        <div className="detail-section">
          <h2>Description</h2>
          <div
            className="opp-description"
            dangerouslySetInnerHTML={{ __html: descHtml }}
          />
        </div>
      )}

      <div className="detail-section">
        <h2>Attachments &amp; Links</h2>
        <ul className="links-list">
          <li>
            <a href={samPageLink} target="_blank" rel="noopener noreferrer">
              SAM.gov Notice Page
            </a>
          </li>
          {attachments.length > 0
            ? attachments.map((a, i) => (
                <li key={i}>
                  <a
                    href={`/api/description?url=${encodeURIComponent(a.url)}`}
                    download={a.name}
                  >
                    {a.name}
                  </a>
                </li>
              ))
            : descProxy && (
                <li>
                  <a href={descProxy} target="_blank" rel="noopener noreferrer">
                    Description / Attachments Package
                  </a>
                </li>
              )}
          {namedLinks.map((l, i) => (
            <li key={`nl-${i}`}>
              <a href={l.url} target="_blank" rel="noopener noreferrer">
                {l.name}
              </a>
            </li>
          ))}
          {opp.additionalInfoLink && (
            <li>
              <a href={opp.additionalInfoLink} target="_blank" rel="noopener noreferrer">
                Additional Information
              </a>
            </li>
          )}
        </ul>
        {attachments.length === 0 && extraLinks.length === 0 && (
          <p style={{ fontSize: 13, color: "#94a3b8", marginTop: 8 }}>
            No attachments found. Check the{" "}
            <a href={samPageLink} target="_blank" rel="noopener noreferrer">SAM.gov notice page</a>{" "}
            directly for files.
          </p>
        )}
      </div>

      <div className="detail-section how-to-submit">
        <h2>How to Submit</h2>
        <>
          <p>
            This notice is on SAM.gov. Submission instructions are in the
            solicitation document. Follow these steps:
          </p>
          <ol className="submit-steps">
            <li>
              Click <strong>Open on SAM.gov</strong> above and read the full
              notice.
            </li>
            <li>
              Download the solicitation package from the{" "}
              {attachments.length > 0 ? (
                <a
                  href={`/api/description?url=${encodeURIComponent(attachments[0].url)}`}
                  download={attachments[0].name}
                >
                  attachments below
                </a>
              ) : descProxy ? (
                <a href={descProxy} target="_blank" rel="noopener noreferrer">
                  description/attachments link
                </a>
              ) : (
                <a href={samPageLink} target="_blank" rel="noopener noreferrer">
                  SAM.gov notice page
                </a>
              )}
              .
            </li>
              <li>
                Identify the submission method — typically email, SAM.gov
                eBuy/eOffer, or a system listed in the solicitation.
              </li>
              <li>
                Prepare your quote or offer: pricing, delivery timeline, company
                info (CAGE, UEI/DUNS, SAM registration active), and any required
                representations.
              </li>
              <li>
                Submit <strong>before</strong> the response deadline:{" "}
                <strong>{formatDateDisplay(deadline)}</strong>.
              </li>
              <li>
                Follow up with the point of contact if you have questions about
                the requirement.
              </li>
            </ol>
          </>
        <div className="checklist-note">
          <strong>Quick checklist before you submit:</strong>
          <ul>
            <li>SAM.gov registration active (check UEI / CAGE)</li>
            <li>NAICS code matches the requirement</li>
            <li>Pricing prepared (unit price, quantity, delivery)</li>
            <li>All required attachments included</li>
            <li>Submission method confirmed (email vs. portal)</li>
          </ul>
        </div>
      </div>

      <div className="copy-footer">
        <button
          onClick={handleAiInvoice}
          disabled={aiLoading}
          className="invoice-btn ai-invoice-btn"
        >
          {aiLoading ? "Generating AI Invoice…" : "Download AI Invoice (Excel)"}
        </button>
        <span className="copy-hint">
          The AI invoice reads the solicitation PDFs and auto-fills line items,
          quantities, part numbers, and terms. Just add your unit prices and send.
        </span>
      </div>
    </div>
  );
}

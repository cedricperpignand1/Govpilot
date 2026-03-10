/**
 * Generates a RFC 4180-compliant CSV from miami_contractor_emails.
 * Always reads from the DB (never directly from Hunter).
 * Suppressed records are never included regardless of filter state.
 */

import { listContractorEmails, ListEmailsParams } from "./db";

const HEADERS = [
  "Company Name",
  "Domain",
  "Email",
  "First Name",
  "Last Name",
  "Position",
  "Department",
  "Email Type",
  "Verification Status",
  "Confidence",
  "Source",
  "LinkedIn URL",
  "Phone",
  "Last Enriched",
];

function escapeCsv(v: string | number | null | undefined): string {
  if (v == null || v === "") return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function generateEmailsCsv(filters: ListEmailsParams): string {
  // Always enforce: no suppressed, exportable only
  const { rows } = listContractorEmails({
    ...filters,
    hideSuppressed: true,
    onlyExportable: true,
    page: 1,
    pageSize: 100_000,
  });

  const lines = [
    HEADERS.map(escapeCsv).join(","),
    ...rows.map((r) =>
      [
        r.companyName,
        r.domain,
        r.email,
        r.firstName,
        r.lastName,
        r.position,
        r.department,
        r.emailType,
        r.verificationStatus,
        r.confidence,
        r.source,
        r.linkedinUrl,
        r.phone,
        r.lastEnrichedAt,
      ]
        .map(escapeCsv)
        .join(",")
    ),
  ];

  return lines.join("\r\n");
}

export function emailExportFilename(): string {
  const d    = new Date();
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, "0");
  const dd   = String(d.getDate()).padStart(2, "0");
  return `miami-contractor-emails-${yyyy}-${mm}-${dd}.csv`;
}

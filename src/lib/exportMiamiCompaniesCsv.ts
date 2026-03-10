/**
 * Generates the miami-companies CSV export.
 * Includes emails found via the website crawler (joined from miami_company_emails).
 * Multiple emails per company are joined with semicolons in the "Emails Found" column.
 */

import { listMiamiCompanies, ListCompaniesParams } from "./db";

const HEADERS = [
  "Company Name",
  "Website",
  "Domain",
  "Address",
  "City",
  "State",
  "Source",
  "Emails Found",
  "Email Count",
  "Last Synced",
  "Last Crawled",
  "Crawl Status",
];

function escapeCsv(v: string | number | null | undefined): string {
  if (v == null || v === "") return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function generateCompaniesCsv(filters: ListCompaniesParams): string {
  const { rows } = listMiamiCompanies({
    ...filters,
    page: 1,
    pageSize: 100_000,
  });

  const lines = [
    HEADERS.map(escapeCsv).join(","),
    ...rows.map((r) => {
      // emailsList is pipe-separated ("a@b.com|||c@d.com") — convert to semicolons
      const emailsStr = r.emailsList
        ? r.emailsList.split("|||").join("; ")
        : "";

      return [
        r.companyName,
        r.website,
        r.domain,
        r.address,
        r.city,
        r.state,
        r.source,
        emailsStr,
        r.emailCount ?? 0,
        r.lastSyncedAt,
        r.lastCrawledAt,
        r.crawlStatus,
      ]
        .map(escapeCsv)
        .join(",");
    }),
  ];

  return lines.join("\r\n");
}

export function companiesExportFilename(): string {
  const d  = new Date();
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `miami-companies-${yy}-${mm}-${dd}.csv`;
}

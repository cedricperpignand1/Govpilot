/**
 * Generates a RFC 4180-compliant CSV from the miami_contractors table.
 * Reads from the database (not from SAM directly) and respects the
 * same filter params as the GET /api/miami-contractors endpoint.
 */

import { listContractors, ListContractorsParams, ContractorRow } from "./db";

const HEADERS = [
  "Company Name",
  "Legal Business Name",
  "UEI",
  "CAGE",
  "NCAGE",
  "Address Line 1",
  "City",
  "State",
  "ZIP",
  "Country",
  "NAICS Codes",
  "Business Types",
  "Registration Status",
  "Activation Date",
  "Expiration Date",
  "Website",
  "Phone",
  "Last Synced",
];

function escapeCsv(value: string | null | undefined): string {
  if (value == null || value === "") return "";
  const s = String(value);
  // Wrap in quotes if the field contains comma, double-quote, or newline
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function parseJsonArray(json: string | null): string {
  if (!json) return "";
  try {
    const arr: string[] = JSON.parse(json);
    return arr.join("; ");
  } catch {
    return json;
  }
}

function rowToCsv(r: ContractorRow): string {
  const fields = [
    r.entityName,
    r.legalBusinessName,
    r.uei,
    r.cageCode,
    r.ncageCode,
    r.physicalAddressLine1,
    r.physicalAddressCity,
    r.physicalAddressState,
    r.physicalAddressZip,
    r.country,
    parseJsonArray(r.naicsCodes),
    parseJsonArray(r.businessTypes),
    r.registrationStatus,
    r.activationDate,
    r.expirationDate,
    r.website,
    r.phone,
    r.lastSyncedAt,
  ];
  return fields.map(escapeCsv).join(",");
}

export function generateContractorsCsv(filters: ListContractorsParams): string {
  // Fetch all matching rows (no pagination — export everything)
  const { rows } = listContractors({ ...filters, page: 1, pageSize: 100_000 });

  const lines = [
    HEADERS.map(escapeCsv).join(","),
    ...rows.map(rowToCsv),
  ];

  return lines.join("\r\n");
}

/** Today's date formatted as YYYY-MM-DD for the filename */
export function exportFilename(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, "0");
  const dd   = String(d.getDate()).padStart(2, "0");
  return `miami-contractors-${yyyy}-${mm}-${dd}.csv`;
}

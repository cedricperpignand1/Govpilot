/**
 * Maps Hunter API email entries into our ContractorEmailRow shape.
 * Every field is null-guarded so malformed Hunter responses never crash a sync.
 */

import { HunterEmailEntry } from "./hunterClient";

export interface MappedEmailRow {
  contractorId: number | null;
  companyName: string | null;
  domain: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  position: string | null;
  department: string | null;
  emailType: string | null;
  verificationStatus: string | null;
  confidence: number | null;
  linkedinUrl: string | null;
  phone: string | null;
  source: string;
  exportable: number;
  suppressed: number;
  notes: string | null;
  rawPayload: string;
  lastEnrichedAt: string;
}

export function mapHunterEmail(
  entry: HunterEmailEntry,
  domain: string,
  contractorId: number | null,
  companyName: string | null
): MappedEmailRow {
  return {
    contractorId,
    companyName,
    domain,
    email:              entry.value,
    firstName:          entry.first_name ?? null,
    lastName:           entry.last_name  ?? null,
    position:           entry.position   ?? null,
    department:         entry.department ?? null,
    emailType:          entry.type       ?? null,
    verificationStatus: entry.verification?.status ?? null,
    confidence:         typeof entry.confidence === "number" ? entry.confidence : null,
    linkedinUrl:        entry.linkedin    ?? null,
    phone:              entry.phone_number ?? null,
    source:             "hunter_domain_search",
    exportable:         1,
    suppressed:         0,
    notes:              null,
    rawPayload:         JSON.stringify(entry),
    lastEnrichedAt:     new Date().toISOString(),
  };
}

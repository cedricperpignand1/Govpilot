/**
 * Syncs Hunter email data for all Miami contractors that have a domain.
 *
 * Expandability:
 *   - To run for all FL: change the WHERE clause on the contractor query
 *   - To run nationwide: remove the city/state filter entirely
 *   - To add email-finder (by name): add a second enrichment pass here
 *
 * Quota protection:
 *   - Skips domains enriched within the last SKIP_ENRICHED_WITHIN_DAYS days
 *   - Stops the entire sync on 429 (quota exceeded) to protect remaining calls
 *   - 1.2 second delay between Hunter API calls
 */

import { db, extractDomain, listDomainsForHunterSync } from "./db";
import { domainSearch, hunterKeyConfigured } from "./hunterClient";
import { mapHunterEmail } from "./hunterMapper";

const SKIP_ENRICHED_WITHIN_DAYS = 7; // don't re-hit Hunter for recently enriched domains

// ─── Upsert statement ─────────────────────────────────────────────────────────

const upsertEmail = db.prepare(`
  INSERT INTO miami_contractor_emails (
    contractorId, companyName, domain, email,
    firstName, lastName, position, department,
    emailType, verificationStatus, confidence,
    linkedinUrl, phone, source, exportable, suppressed,
    notes, rawPayload, lastEnrichedAt,
    createdAt, updatedAt
  ) VALUES (
    @contractorId, @companyName, @domain, @email,
    @firstName, @lastName, @position, @department,
    @emailType, @verificationStatus, @confidence,
    @linkedinUrl, @phone, @source, @exportable, @suppressed,
    @notes, @rawPayload, @lastEnrichedAt,
    datetime('now'), datetime('now')
  )
  ON CONFLICT(domain, email) DO UPDATE SET
    contractorId       = excluded.contractorId,
    companyName        = excluded.companyName,
    firstName          = excluded.firstName,
    lastName           = excluded.lastName,
    position           = excluded.position,
    department         = excluded.department,
    emailType          = excluded.emailType,
    verificationStatus = excluded.verificationStatus,
    confidence         = excluded.confidence,
    linkedinUrl        = excluded.linkedinUrl,
    phone              = excluded.phone,
    rawPayload         = excluded.rawPayload,
    lastEnrichedAt     = excluded.lastEnrichedAt,
    updatedAt          = datetime('now')
`);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EmailSyncStats {
  totalCompanies: number;
  skippedMissingDomain: number;
  skippedRecentlyEnriched: number;
  domainsSubmitted: number;     // domains actually sent to Hunter API
  domainsEnriched: number;      // alias of domainsSubmitted (kept for compat)
  domainsWithEmails: number;    // domains that returned ≥1 email
  domainsWithZeroEmails: number; // domains Hunter found but returned 0 emails
  emailsFound: number;
  inserted: number;
  updated: number;
  failed: number;
  errors: string[];
  zeroEmailDomains: string[];   // list of domains where Hunter returned 0 emails
  stoppedEarly: boolean;        // true if we hit a 429 quota error
}

// ─── Sync ─────────────────────────────────────────────────────────────────────

export async function syncMiamiContractorEmails(): Promise<EmailSyncStats> {
  if (!hunterKeyConfigured()) {
    throw new Error("HUNTER_API_KEY is not configured. Add it to .env.local.");
  }

  const stats: EmailSyncStats = {
    totalCompanies: 0, skippedMissingDomain: 0, skippedRecentlyEnriched: 0,
    domainsSubmitted: 0, domainsEnriched: 0,
    domainsWithEmails: 0, domainsWithZeroEmails: 0,
    emailsFound: 0, inserted: 0, updated: 0, failed: 0,
    errors: [], zeroEmailDomains: [], stoppedEarly: false,
  };

  // 1. Load companies from both miami_contractors and miami_companies
  const contractors = listDomainsForHunterSync();

  stats.totalCompanies = contractors.length;

  // Track which domains we've already processed this run (dedup across contractors sharing a domain)
  const processedDomains = new Set<string>();

  // Cutoff: skip domains enriched within the past N days
  const skipBefore = new Date(Date.now() - SKIP_ENRICHED_WITHIN_DAYS * 86_400_000).toISOString();

  for (const contractor of contractors) {
    // Derive domain from stored domain or website
    const domain =
      contractor.domain ||
      extractDomain(contractor.website);

    if (!domain) {
      stats.skippedMissingDomain++;
      if (contractor.sourceTable === "miami_contractors") {
        db.prepare("UPDATE miami_contractors SET domain = 'missing_domain' WHERE id = ?").run(contractor.id);
      }
      continue;
    }

    // Persist derived domain back to the source table
    if (!contractor.domain && domain !== "missing_domain") {
      const table = contractor.sourceTable === "miami_contractors" ? "miami_contractors" : "miami_companies";
      db.prepare(`UPDATE ${table} SET domain = ? WHERE id = ?`).run(domain, contractor.id);
    }

    if (processedDomains.has(domain)) {
      // Already queued in this run; link the contractor but don't re-fetch
      continue;
    }

    // Skip recently enriched domains
    const recentRow = db.prepare(
      "SELECT MAX(lastEnrichedAt) AS lat FROM miami_contractor_emails WHERE domain = ?"
    ).get(domain) as { lat: string | null };

    if (recentRow?.lat && recentRow.lat > skipBefore) {
      stats.skippedRecentlyEnriched++;
      processedDomains.add(domain);
      continue;
    }

    processedDomains.add(domain);

    const companyName = contractor.companyName ?? null;

    try {
      console.log(`[hunter] Searching domain: ${domain} (${companyName ?? "unknown"})`);
      const result = await domainSearch(domain);
      stats.domainsSubmitted++;
      stats.domainsEnriched++;

      if (result.emails.length === 0) {
        stats.domainsWithZeroEmails++;
        stats.zeroEmailDomains.push(domain);
        console.log(`[hunter]   → 0 emails found for ${domain}`);
      } else {
        stats.domainsWithEmails++;
        console.log(`[hunter]   → ${result.emails.length} email(s) found for ${domain}`);
      }

      stats.emailsFound += result.emails.length;

      // Check existing UEIs for insert vs update tracking
      const existingEmails = new Set(
        (db.prepare(
          "SELECT email FROM miami_contractor_emails WHERE domain = ?"
        ).all(domain) as { email: string }[]).map((r) => r.email)
      );

      // Batch upsert all emails in a single transaction
      const upsertBatch = db.transaction(() => {
        for (const entry of result.emails) {
          try {
            const row = mapHunterEmail(entry, domain, contractor.id, companyName);
            upsertEmail.run(row);
            if (existingEmails.has(entry.value)) stats.updated++;
            else stats.inserted++;
          } catch (err) {
            stats.failed++;
            stats.errors.push(`${domain}/${entry.value}: ${String(err)}`);
          }
        }
      });

      upsertBatch();

    } catch (err: unknown) {
      const status = (err as { status?: number }).status;

      // On quota exceeded, stop processing to preserve remaining calls
      if (status === 429) {
        stats.errors.push(`Quota exceeded (429) — sync stopped after ${stats.domainsEnriched} domains.`);
        stats.stoppedEarly = true;
        break;
      }

      const msg = `${domain}: ${String(err)}`;
      console.error(`[hunter] Failed —`, msg);
      stats.failed++;
      stats.errors.push(msg);
      // Continue to next domain
    }
  }

  console.log(
    `[hunter] Sync done.\n` +
    `  Companies: ${stats.totalCompanies} total, ${stats.skippedMissingDomain} no domain, ` +
    `${stats.skippedRecentlyEnriched} recently cached\n` +
    `  Hunter API: ${stats.domainsSubmitted} domains submitted, ` +
    `${stats.domainsWithEmails} with emails, ${stats.domainsWithZeroEmails} with zero emails\n` +
    `  Emails: ${stats.emailsFound} found — ${stats.inserted} inserted, ` +
    `${stats.updated} updated, ${stats.failed} failed`
  );

  return stats;
}

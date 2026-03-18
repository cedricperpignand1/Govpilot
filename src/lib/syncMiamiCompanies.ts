/**
 * Syncs Miami construction companies from Google Places API.
 *
 * Strategy (expanded):
 *   1. Generate all (trade × locality) query combinations from miamiSearchConfig.ts,
 *      plus optional ZIP-based queries, up to MAX_QUERIES_PER_SYNC.
 *   2. Run each query through Text Search (up to 3 pages = 60 results each).
 *   3. Deduplicate by googlePlaceId across all query results.
 *   4. Filter out irrelevant place types and name patterns.
 *   5. For each unique place_id not already in DB:
 *      a. Check if domain already in DB from a different place — skip if so.
 *      b. Fetch Place Details (website, address).
 *      c. Skip places without a website.
 *      d. Upsert into miami_companies.
 *   6. Return detailed stats.
 *
 * To expand to all Florida:
 *   - Add Florida cities to LOCALITIES in miamiSearchConfig.ts
 *   - Add Florida ZIPs to MIAMI_DADE_ZIPS in miamiSearchConfig.ts
 *   - Update MIAMI_CENTER_LAT/LNG and MIAMI_RADIUS in googlePlacesClient.ts
 *   - Increase MAX_QUERIES_PER_SYNC in miamiSearchConfig.ts
 *   - No schema changes needed
 */

import { db } from "./db";
import { textSearchAll, fetchPlaceDetails, placesKeyConfigured, PlacesTextSearchResult, LocationBias } from "./googlePlacesClient";
import { mapPlaceDetails } from "./googlePlacesMapper";

const MIAMI_BIAS: LocationBias = { lat: "25.7617", lng: "-80.1918", radius: "50000" };
import {
  TRADES,
  LOCALITIES,
  MIAMI_DADE_ZIPS,
  ZIP_QUERY_TRADES,
  EXCLUDE_PLACE_TYPES,
  EXCLUDE_NAME_KEYWORDS,
  MAX_QUERIES_PER_SYNC,
  ENABLE_ZIP_QUERIES,
  INTER_QUERY_DELAY_MS,
  RETRY_BASE_DELAY_MS,
  MAX_RETRIES,
} from "./miamiSearchConfig";

// ─── Upsert statement ─────────────────────────────────────────────────────────

const upsertCompany = db.prepare(`
  INSERT INTO miami_companies (
    companyName, website, domain, address, city, state,
    googlePlaceId, source, rawPayload, lastSyncedAt,
    createdAt, updatedAt
  ) VALUES (
    @companyName, @website, @domain, @address, @city, @state,
    @googlePlaceId, @source, @rawPayload, @lastSyncedAt,
    datetime('now'), datetime('now')
  )
  ON CONFLICT(googlePlaceId) DO UPDATE SET
    companyName   = excluded.companyName,
    website       = excluded.website,
    domain        = excluded.domain,
    address       = excluded.address,
    city          = excluded.city,
    state         = excluded.state,
    rawPayload    = excluded.rawPayload,
    lastSyncedAt  = excluded.lastSyncedAt,
    updatedAt     = datetime('now')
`);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CompaniesSyncStats {
  // Query phase
  queriesTotal: number;            // how many queries were planned
  queriesExecuted: number;         // how many text searches actually ran
  queriesFailed: number;           // non-fatal query failures
  rawPlacesFound: number;          // total place stubs collected before dedup
  dupsRemovedByPlaceId: number;    // stubs removed because place_id already seen
  filteredOutIrrelevant: number;   // stubs removed by type/name filter
  uniquePlacesToProcess: number;   // unique places passed to the detail phase

  // Detail phase
  skippedAlreadyInDb: number;      // place_id already in DB (detail call skipped)
  skippedDomainDuplicate: number;  // same domain already saved from another place
  skippedNoWebsite: number;        // place returned no website
  companiesWithWebsite: number;    // places that had a website
  domainsExtracted: number;        // places where domain was parsed from website
  companiesSaved: number;          // total rows written to DB
  inserted: number;                // new rows
  updated: number;                 // updated rows
  failed: number;                  // individual place failures

  errors: string[];
  stoppedEarly: boolean;           // true if quota/auth error stopped the sync
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/** Retry wrapper for transient errors. Never retries 429 or 403. */
async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      // Quota and auth errors: propagate immediately
      if (status === 429 || status === 403) throw err;
      // Last attempt: propagate
      if (attempt > MAX_RETRIES) throw err;
      const delay = RETRY_BASE_DELAY_MS * attempt;
      console.warn(`[places] ${label} — attempt ${attempt} failed, retrying in ${delay}ms. Error: ${String(err)}`);
      await sleep(delay);
    }
  }
  throw new Error("Unreachable");
}

/** Returns true if this place's types or name indicate it's NOT a construction business. */
function isIrrelevant(place: PlacesTextSearchResult): boolean {
  // Check Google Places types array
  const typeSet = new Set(place.types ?? []);
  for (const excluded of EXCLUDE_PLACE_TYPES) {
    if (typeSet.has(excluded)) return true;
  }
  // Check name keywords (case-insensitive)
  const nameLower = (place.name ?? "").toLowerCase();
  for (const kw of EXCLUDE_NAME_KEYWORDS) {
    if (nameLower.includes(kw.toLowerCase())) return true;
  }
  return false;
}

/** Build all search query strings in priority order. */
function buildQueryList(): string[] {
  const queries: string[] = [];

  // Priority 1: trade × locality (core strategy, ordered by trade then locality
  // so each trade gets full geographic coverage before the next trade starts)
  for (const trade of TRADES) {
    for (const locality of LOCALITIES) {
      queries.push(`${trade} ${locality}`);
    }
  }

  // Priority 2: ZIP-based queries (supplementary geographic coverage)
  if (ENABLE_ZIP_QUERIES) {
    for (const trade of ZIP_QUERY_TRADES) {
      for (const zip of MIAMI_DADE_ZIPS) {
        queries.push(`${trade} ${zip}`);
      }
    }
  }

  // Apply cap — subsequent sync runs will produce the same priority-ordered list,
  // so re-running syncs incrementally refines coverage as more queries execute.
  return queries.slice(0, MAX_QUERIES_PER_SYNC);
}

// ─── Sync ─────────────────────────────────────────────────────────────────────

export async function syncMiamiCompanies(): Promise<CompaniesSyncStats> {
  if (!placesKeyConfigured()) {
    throw new Error("GOOGLE_PLACES_API_KEY is not configured. Add it to .env.local.");
  }

  const stats: CompaniesSyncStats = {
    queriesTotal: 0, queriesExecuted: 0, queriesFailed: 0,
    rawPlacesFound: 0, dupsRemovedByPlaceId: 0, filteredOutIrrelevant: 0,
    uniquePlacesToProcess: 0, skippedAlreadyInDb: 0, skippedDomainDuplicate: 0,
    skippedNoWebsite: 0, companiesWithWebsite: 0, domainsExtracted: 0,
    companiesSaved: 0, inserted: 0, updated: 0, failed: 0,
    errors: [], stoppedEarly: false,
  };

  // ── Phase 1: Text search — collect unique place stubs ─────────────────────

  const queries = buildQueryList();
  stats.queriesTotal = queries.length;

  // Map: placeId → name (for dedup and logging)
  const seenPlaceIds = new Map<string, string>();

  console.log(`[places] Starting sync: ${queries.length} queries planned (cap: ${MAX_QUERIES_PER_SYNC})`);

  for (let i = 0; i < queries.length; i++) {
    const query = queries[i];
    if (i > 0) await sleep(INTER_QUERY_DELAY_MS);

    console.log(`[places] [${i + 1}/${queries.length}] Text search: "${query}"`);

    try {
      const results = await withRetry(`text search "${query}"`, () => textSearchAll(query, MIAMI_BIAS));
      stats.rawPlacesFound += results.length;
      stats.queriesExecuted++;

      let newFromThisQuery = 0;
      for (const r of results) {
        if (seenPlaceIds.has(r.place_id)) {
          stats.dupsRemovedByPlaceId++;
          continue;
        }
        if (isIrrelevant(r)) {
          stats.filteredOutIrrelevant++;
          continue;
        }
        seenPlaceIds.set(r.place_id, r.name);
        newFromThisQuery++;
      }
      console.log(
        `[places]   → ${results.length} raw, ${newFromThisQuery} new unique — total unique: ${seenPlaceIds.size}`
      );

    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      const msg = `Text search "${query}": ${String(err)}`;

      if (status === 429 || status === 403) {
        console.error(`[places] Quota/auth error — stopping sync. ${msg}`);
        stats.errors.push(msg);
        stats.stoppedEarly = true;
        break;
      }

      console.error(`[places] Non-fatal query error — continuing. ${msg}`);
      stats.queriesFailed++;
      stats.errors.push(msg);
    }
  }

  stats.uniquePlacesToProcess = seenPlaceIds.size;
  console.log(
    `[places] Text search phase done. Unique places: ${stats.uniquePlacesToProcess} ` +
    `(raw: ${stats.rawPlacesFound}, dups: ${stats.dupsRemovedByPlaceId}, ` +
    `filtered: ${stats.filteredOutIrrelevant}, queries failed: ${stats.queriesFailed})`
  );

  if (stats.stoppedEarly) return stats;

  // ── Phase 2: Place Details — fetch website and upsert ─────────────────────

  // Load existing place_ids so we know insert vs update
  const existingPlaceIds = new Set(
    (db.prepare("SELECT googlePlaceId FROM miami_companies").all() as { googlePlaceId: string }[])
      .map((r) => r.googlePlaceId)
  );

  // Load existing domains to prevent duplicate domain rows
  // (two different Place IDs might point to the same business with the same website)
  const existingDomains = new Map<string, string>(
    (db.prepare(
      "SELECT domain, googlePlaceId FROM miami_companies WHERE domain IS NOT NULL AND domain != ''"
    ).all() as { domain: string; googlePlaceId: string }[])
      .map((r) => [r.domain, r.googlePlaceId] as [string, string])
  );

  // Also track domains seen during THIS run so we don't fetch two places with
  // the same domain that aren't yet in DB (e.g., same company, two listings)
  const seenDomainsThisRun = new Set<string>();

  let placeCount = 0;
  for (const [placeId, name] of seenPlaceIds) {
    placeCount++;

    // Skip if already fully processed in a previous sync (detail already in DB)
    if (existingPlaceIds.has(placeId)) {
      stats.skippedAlreadyInDb++;
      continue;
    }

    try {
      const details = await withRetry(
        `Place Details ${placeId} (${name})`,
        () => fetchPlaceDetails(placeId)
      );

      if (!details) {
        stats.errors.push(`${placeId} (${name}): Place Details returned no result`);
        continue;
      }

      if (!details.website) {
        stats.skippedNoWebsite++;
        continue;
      }

      stats.companiesWithWebsite++;
      const row = mapPlaceDetails(details);

      // Domain dedup: skip if domain already saved (from a previous sync or this run)
      if (row.domain) {
        if (existingDomains.has(row.domain) && existingDomains.get(row.domain) !== placeId) {
          stats.skippedDomainDuplicate++;
          console.log(`[places]   Skipping ${name} — domain "${row.domain}" already saved from another place`);
          continue;
        }
        if (seenDomainsThisRun.has(row.domain)) {
          stats.skippedDomainDuplicate++;
          continue;
        }
        seenDomainsThisRun.add(row.domain);
        stats.domainsExtracted++;
      }

      upsertCompany.run(row);

      if (existingPlaceIds.has(placeId)) {
        stats.updated++;
      } else {
        stats.inserted++;
        existingPlaceIds.add(placeId);
      }

      if (row.domain) existingDomains.set(row.domain, placeId);
      stats.companiesSaved++;

      if (placeCount % 50 === 0) {
        console.log(
          `[places]   Progress: ${placeCount}/${stats.uniquePlacesToProcess} places processed, ` +
          `${stats.companiesSaved} saved so far`
        );
      }

    } catch (err: unknown) {
      const status = (err as { status?: number }).status;

      if (status === 429 || status === 403) {
        const msg = `Quota/auth error fetching details for ${placeId}: ${String(err)}`;
        console.error(`[places] ${msg} — stopping sync.`);
        stats.errors.push(msg);
        stats.stoppedEarly = true;
        break;
      }

      const msg = `${placeId} (${name}): ${String(err)}`;
      console.error(`[places] Detail failed (non-fatal) —`, msg);
      stats.failed++;
      stats.errors.push(msg);
    }
  }

  console.log(
    `[places] Sync complete.\n` +
    `  Queries: ${stats.queriesExecuted}/${stats.queriesTotal} run, ${stats.queriesFailed} failed\n` +
    `  Text search: ${stats.rawPlacesFound} raw → ${stats.uniquePlacesToProcess} unique ` +
    `(${stats.dupsRemovedByPlaceId} dup, ${stats.filteredOutIrrelevant} filtered)\n` +
    `  Detail phase: ${stats.skippedAlreadyInDb} already in DB, ${stats.skippedNoWebsite} no website, ` +
    `${stats.skippedDomainDuplicate} domain dup\n` +
    `  Saved: ${stats.companiesSaved} (${stats.inserted} new, ${stats.updated} updated, ${stats.failed} failed)\n` +
    `  Domains extracted: ${stats.domainsExtracted}`
  );

  return stats;
}

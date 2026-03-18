/**
 * Generic company sync — searches Google Places for any keyword in any location.
 *
 * Usage: syncCompanies("architects", "New York")
 *   → Runs text search "architects New York" without a location bias,
 *     letting Google's own geocoding place results appropriately.
 *   → Saves results to scraped_companies table.
 *
 * To run multiple queries (e.g., "architect firm New York", "architect New York"),
 * pass an array of keywords — each will be combined with the location.
 */

import { db } from "./db";
import { textSearchAll, fetchPlaceDetails, placesKeyConfigured, geocodeLocation, PlacesTextSearchResult } from "./googlePlacesClient";
import { mapPlaceDetails } from "./googlePlacesMapper";

const INTER_QUERY_DELAY_MS  = 300;
const RETRY_BASE_DELAY_MS   = 2_000;
const MAX_RETRIES           = 2;

// ─── Upsert ───────────────────────────────────────────────────────────────────

const upsertCompany = db.prepare(`
  INSERT INTO scraped_companies (
    companyName, website, domain, address, city, state,
    googlePlaceId, keyword, searchLocation, source, rawPayload,
    lastSyncedAt, createdAt, updatedAt
  ) VALUES (
    @companyName, @website, @domain, @address, @city, @state,
    @googlePlaceId, @keyword, @searchLocation, @source, @rawPayload,
    @lastSyncedAt, datetime('now'), datetime('now')
  )
  ON CONFLICT(googlePlaceId) DO UPDATE SET
    companyName    = excluded.companyName,
    website        = excluded.website,
    domain         = excluded.domain,
    address        = excluded.address,
    city           = excluded.city,
    state          = excluded.state,
    keyword        = excluded.keyword,
    searchLocation = excluded.searchLocation,
    rawPayload     = excluded.rawPayload,
    lastSyncedAt   = excluded.lastSyncedAt,
    updatedAt      = datetime('now')
`);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SyncCompaniesStats {
  keyword: string;
  searchLocation: string;
  queriesTotal: number;
  queriesExecuted: number;
  queriesFailed: number;
  rawPlacesFound: number;
  dupsRemovedByPlaceId: number;
  uniquePlacesToProcess: number;
  skippedAlreadyInDb: number;
  skippedDomainDuplicate: number;
  skippedNoWebsite: number;
  companiesWithWebsite: number;
  domainsExtracted: number;
  companiesSaved: number;
  inserted: number;
  updated: number;
  failed: number;
  errors: string[];
  stoppedEarly: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if (status === 429 || status === 403) throw err;
      if (attempt > MAX_RETRIES) throw err;
      const delay = RETRY_BASE_DELAY_MS * attempt;
      console.warn(`[places] ${label} — attempt ${attempt} failed, retrying in ${delay}ms. Error: ${String(err)}`);
      await sleep(delay);
    }
  }
  throw new Error("Unreachable");
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Sync companies for a given keyword and one or more locations.
 * @param keyword    e.g. "architects"
 * @param locations  comma-separated string or array — e.g. "Miami, New York, Austin"
 */
export async function syncCompanies(
  keyword: string,
  locations: string | string[],
  extraKeywords: string[] = [],
): Promise<SyncCompaniesStats> {
  if (!placesKeyConfigured()) {
    throw new Error("GOOGLE_PLACES_API_KEY is not configured. Add it to .env.local.");
  }

  // Normalise locations to an array
  const locationList = (Array.isArray(locations) ? locations : locations.split(","))
    .map((l) => l.trim())
    .filter(Boolean);

  const locationLabel = locationList.join(", ");
  const keywords = [keyword, ...extraKeywords].filter(Boolean);

  const stats: SyncCompaniesStats = {
    keyword, searchLocation: locationLabel,
    queriesTotal: 0, queriesExecuted: 0, queriesFailed: 0,
    rawPlacesFound: 0, dupsRemovedByPlaceId: 0, uniquePlacesToProcess: 0,
    skippedAlreadyInDb: 0, skippedDomainDuplicate: 0, skippedNoWebsite: 0,
    companiesWithWebsite: 0, domainsExtracted: 0,
    companiesSaved: 0, inserted: 0, updated: 0, failed: 0,
    errors: [], stoppedEarly: false,
  };

  // ── Phase 1: Text search across all locations ─────────────────────────────

  const seenPlaceIds = new Map<string, { name: string; location: string }>();

  for (const location of locationList) {
    // Geocode this location
    const biasResult = await geocodeLocation(location);
    if (biasResult) {
      console.log(`[companies] Geocoded "${location}" → lat=${biasResult.lat} lng=${biasResult.lng}`);
    } else {
      console.warn(`[companies] Could not geocode "${location}"`);
    }
    const bias = biasResult ?? undefined;

    const queries = keywords.map((kw) => `${kw} ${location}`);
    stats.queriesTotal += queries.length;

    for (let i = 0; i < queries.length; i++) {
      const query = queries[i];
      if (i > 0) await sleep(INTER_QUERY_DELAY_MS);

      console.log(`[companies] Text search: "${query}"`);

      try {
        const results = await withRetry(`text search "${query}"`, () => textSearchAll(query, bias));
        stats.rawPlacesFound += results.length;
        stats.queriesExecuted++;

        let newFromThisQuery = 0;
        for (const r of results) {
          if (seenPlaceIds.has(r.place_id)) { stats.dupsRemovedByPlaceId++; continue; }
          seenPlaceIds.set(r.place_id, { name: r.name, location });
          newFromThisQuery++;
        }
        console.log(`[companies]   → ${results.length} raw, ${newFromThisQuery} new unique`);

      } catch (err: unknown) {
        const status = (err as { status?: number }).status;
        const msg = `Text search "${query}": ${String(err)}`;
        if (status === 429 || status === 403) {
          console.error(`[companies] Quota/auth error — stopping. ${msg}`);
          stats.errors.push(msg);
          stats.stoppedEarly = true;
          break;
        }
        console.error(`[companies] Non-fatal query error. ${msg}`);
        stats.queriesFailed++;
        stats.errors.push(msg);
      }
    }

    if (stats.stoppedEarly) break;
  }

  stats.uniquePlacesToProcess = seenPlaceIds.size;
  if (stats.stoppedEarly) return stats;

  // ── Phase 2: Place Details ────────────────────────────────────────────────

  const existingPlaceIds = new Set(
    (db.prepare("SELECT googlePlaceId FROM scraped_companies").all() as { googlePlaceId: string }[])
      .map((r) => r.googlePlaceId)
  );

  const existingDomains = new Map<string, string>(
    (db.prepare(
      "SELECT domain, googlePlaceId FROM scraped_companies WHERE domain IS NOT NULL AND domain != ''"
    ).all() as { domain: string; googlePlaceId: string }[])
      .map((r) => [r.domain, r.googlePlaceId] as [string, string])
  );

  const seenDomainsThisRun = new Set<string>();

  for (const [placeId, { name, location }] of seenPlaceIds) {
    if (existingPlaceIds.has(placeId)) { stats.skippedAlreadyInDb++; continue; }

    try {
      const details = await withRetry(
        `Place Details ${placeId} (${name})`,
        () => fetchPlaceDetails(placeId)
      );

      if (!details) { stats.errors.push(`${placeId} (${name}): no result`); continue; }
      if (!details.website) { stats.skippedNoWebsite++; continue; }

      stats.companiesWithWebsite++;
      const row = mapPlaceDetails(details);

      if (row.domain) {
        if (existingDomains.has(row.domain) && existingDomains.get(row.domain) !== placeId) {
          stats.skippedDomainDuplicate++; continue;
        }
        if (seenDomainsThisRun.has(row.domain)) { stats.skippedDomainDuplicate++; continue; }
        seenDomainsThisRun.add(row.domain);
        stats.domainsExtracted++;
      }

      upsertCompany.run({ ...row, keyword, searchLocation: location });

      if (existingPlaceIds.has(placeId)) { stats.updated++; }
      else { stats.inserted++; existingPlaceIds.add(placeId); }
      if (row.domain) existingDomains.set(row.domain, placeId);
      stats.companiesSaved++;

    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if (status === 429 || status === 403) {
        const msg = `Quota/auth error for ${placeId}: ${String(err)}`;
        stats.errors.push(msg); stats.stoppedEarly = true; break;
      }
      stats.failed++;
      stats.errors.push(`${placeId} (${name}): ${String(err)}`);
    }
  }

  console.log(`[companies] Sync complete. Saved: ${stats.companiesSaved} (${stats.inserted} new, ${stats.updated} updated)`);
  return stats;
}

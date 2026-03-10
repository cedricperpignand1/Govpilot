/**
 * Orchestrates a full sync of Miami construction contractors from SAM.gov.
 *
 * Strategy:
 *  1. Loop through each construction NAICS code.
 *  2. Fetch all pages for city=Miami, state=FL, registrationStatus=Active.
 *  3. Deduplicate by UEI across all NAICS responses.
 *  4. Upsert into the local SQLite database.
 *  5. Return stats: fetched, inserted, updated, failed.
 *
 * To expand to all FL or nationwide later:
 *  - Change DEFAULT_CITY / DEFAULT_STATE or make them params.
 *  - Remove the physicalAddressCity filter for statewide.
 */

import { db } from "./db";
import { fetchEntitiesForNaics, SamEntityData } from "./samEntityClient";
import { mapEntity } from "./samEntityMapper";

// ─── Configuration ────────────────────────────────────────────────────────────

export const DEFAULT_CITY  = "Miami";
export const DEFAULT_STATE = "FL";

// Construction NAICS codes to query
export const CONSTRUCTION_NAICS: Record<string, string> = {
  "236220": "Commercial Building Construction",
  "236210": "Industrial Building Construction",
  "237310": "Highway, Street, and Bridge Construction",
  "237110": "Water and Sewer Line and Related Structures Construction",
  "238220": "Plumbing, Heating, and Air-Conditioning Contractors",
  "238210": "Electrical Contractors and Other Wiring Installation Contractors",
  "238990": "All Other Specialty Trade Contractors",
};

const INTER_NAICS_DELAY_MS = 1_000; // 1 second between NAICS calls

// ─── Upsert statement ─────────────────────────────────────────────────────────

const upsertStmt = db.prepare(`
  INSERT INTO miami_contractors (
    entityName, legalBusinessName, uei, cageCode, ncageCode,
    physicalAddressLine1, physicalAddressCity, physicalAddressState,
    physicalAddressZip, country, naicsCodes, businessTypes,
    registrationStatus, activationDate, expirationDate,
    website, phone, rawPayload, source, lastSyncedAt,
    createdAt, updatedAt
  ) VALUES (
    @entityName, @legalBusinessName, @uei, @cageCode, @ncageCode,
    @physicalAddressLine1, @physicalAddressCity, @physicalAddressState,
    @physicalAddressZip, @country, @naicsCodes, @businessTypes,
    @registrationStatus, @activationDate, @expirationDate,
    @website, @phone, @rawPayload, @source, @lastSyncedAt,
    datetime('now'), datetime('now')
  )
  ON CONFLICT(uei) DO UPDATE SET
    entityName           = excluded.entityName,
    legalBusinessName    = excluded.legalBusinessName,
    cageCode             = excluded.cageCode,
    ncageCode            = excluded.ncageCode,
    physicalAddressLine1 = excluded.physicalAddressLine1,
    physicalAddressCity  = excluded.physicalAddressCity,
    physicalAddressState = excluded.physicalAddressState,
    physicalAddressZip   = excluded.physicalAddressZip,
    country              = excluded.country,
    naicsCodes           = excluded.naicsCodes,
    businessTypes        = excluded.businessTypes,
    registrationStatus   = excluded.registrationStatus,
    activationDate       = excluded.activationDate,
    expirationDate       = excluded.expirationDate,
    website              = excluded.website,
    phone                = excluded.phone,
    rawPayload           = excluded.rawPayload,
    lastSyncedAt         = excluded.lastSyncedAt,
    updatedAt            = datetime('now')
`);

// ─── Sync function ────────────────────────────────────────────────────────────

export interface SyncStats {
  totalFetched: number;
  inserted: number;
  updated: number;
  failed: number;
  errors: string[];
}

export async function syncMiamiContractors(
  city = DEFAULT_CITY,
  state = DEFAULT_STATE
): Promise<SyncStats> {
  const stats: SyncStats = { totalFetched: 0, inserted: 0, updated: 0, failed: 0, errors: [] };

  // We'll collect all unique entities keyed by UEI
  const byUei = new Map<string, SamEntityData>();
  // Entities without a UEI (edge case) — store by index
  const noUei: SamEntityData[] = [];

  const naicsCodes = Object.keys(CONSTRUCTION_NAICS);

  for (let i = 0; i < naicsCodes.length; i++) {
    const naicsCode = naicsCodes[i];
    if (i > 0) await new Promise((r) => setTimeout(r, INTER_NAICS_DELAY_MS));

    console.log(`[sync] Fetching NAICS ${naicsCode} (${CONSTRUCTION_NAICS[naicsCode]})…`);

    try {
      const entities = await fetchEntitiesForNaics({
        city,
        state,
        naicsCode,
        onProgress: (fetched, total) =>
          console.log(`[sync]   ${naicsCode}: ${fetched}/${total}`),
      });

      for (const entity of entities) {
        const uei = entity.entityRegistration?.ueiSAM;
        if (uei) {
          byUei.set(uei, entity); // deduplication: last NAICS call wins (same entity, same data)
        } else {
          noUei.push(entity);
        }
      }

      console.log(`[sync] NAICS ${naicsCode}: ${entities.length} entities fetched`);
    } catch (err) {
      const msg = `NAICS ${naicsCode}: ${String(err)}`;
      console.error(`[sync] Error —`, msg);
      stats.errors.push(msg);
    }
  }

  // Merge deduplicated sets
  const allEntities: SamEntityData[] = [...byUei.values(), ...noUei];
  stats.totalFetched = allEntities.length;
  console.log(`[sync] Total unique entities to upsert: ${allEntities.length}`);

  // Check which UEIs already exist so we can count inserts vs updates
  const existingUeis = new Set(
    (db.prepare("SELECT uei FROM miami_contractors WHERE uei IS NOT NULL").all() as { uei: string }[])
      .map((r) => r.uei)
  );

  // Batch upsert inside a transaction for speed
  const upsertMany = db.transaction((entities: SamEntityData[]) => {
    for (const entity of entities) {
      try {
        const row = mapEntity(entity);
        upsertStmt.run(row);

        const isNew = !existingUeis.has(row.uei ?? "");
        if (isNew) stats.inserted++;
        else stats.updated++;
      } catch (err) {
        stats.failed++;
        const uei = entity.entityRegistration?.ueiSAM ?? "unknown";
        const msg = `UEI ${uei}: ${String(err)}`;
        console.error(`[sync] Upsert failed —`, msg);
        stats.errors.push(msg);
      }
    }
  });

  upsertMany(allEntities);

  console.log(
    `[sync] Done. fetched=${stats.totalFetched} inserted=${stats.inserted} updated=${stats.updated} failed=${stats.failed}`
  );

  return stats;
}

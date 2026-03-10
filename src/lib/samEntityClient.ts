/**
 * SAM.gov Entity Management API v3 client.
 *
 * Endpoint: GET https://api.sam.gov/entity-information/v3/entities
 *
 * The API only accepts ONE value per filter param (e.g. primaryNaics).
 * To search multiple NAICS codes the caller must iterate and deduplicate.
 *
 * Rate limits: SAM.gov enforces per-minute and per-day limits on the key.
 * We add a small inter-request delay and retry once on 429.
 */

const SAM_BASE = process.env.SAM_BASE_URL ?? "https://api.sam.gov";
const SAM_KEY  = process.env.SAM_API_KEY ?? "";

const PAGE_SIZE = 100; // max SAM allows per page
const REQUEST_DELAY_MS = 500; // polite pause between pages / NAICS calls
const RETRY_DELAY_MS   = 5_000; // wait before 429 retry

// ─── SAM Entity response types (only fields we care about) ──────────────────

export interface SamAddress {
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  stateOrProvinceCode?: string | null;
  zipCode?: string | null;
  zipCodePlus4?: string | null;
  countryCode?: string | null;
}

export interface SamNaicsEntry {
  naicsCode?: string | null;
  naicsDescription?: string | null;
  isPrimary?: boolean | null;
}

export interface SamBusinessTypeEntry {
  businessTypeCode?: string | null;
  businessTypeDesc?: string | null;
}

export interface SamPOC {
  firstName?: string | null;
  lastName?: string | null;
  usPhone?: string | null;
  email?: string | null;
}

export interface SamEntityData {
  entityRegistration?: {
    ueiSAM?: string | null;
    cageCode?: string | null;
    nCageCode?: string | null;
    legalBusinessName?: string | null;
    dbaName?: string | null;
    registrationStatus?: string | null;
    activationDate?: string | null;
    registrationExpirationDate?: string | null;
    lastUpdateDate?: string | null;
  } | null;
  coreData?: {
    physicalAddress?: SamAddress | null;
    entityInformation?: {
      entityURL?: string | null;
    } | null;
    businessTypes?: {
      businessTypeList?: SamBusinessTypeEntry[] | null;
      sbaBusinessTypeList?: Array<{ sbaBusinessTypeDesc?: string | null }> | null;
    } | null;
  } | null;
  assertions?: {
    goodsAndServices?: {
      primaryNaics?: string | null;
      naicsList?: SamNaicsEntry[] | null;
    } | null;
  } | null;
  pointsOfContact?: {
    governmentBusinessPOC?: SamPOC | null;
    electronicBusinessPOC?: SamPOC | null;
    pastPerformancePOC?: SamPOC | null;
  } | null;
}

interface SamEntityResponse {
  totalRecords?: number;
  entityData?: SamEntityData[];
  links?: unknown[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildUrl(params: Record<string, string>): string {
  // Dates need literal slashes; everything else URL-encode normally
  const parts = Object.entries(params).map(
    ([k, v]) => `${k}=${encodeURIComponent(v)}`
  );
  parts.unshift(`api_key=${encodeURIComponent(SAM_KEY)}`);
  return `${SAM_BASE}/entity-information/v3/entities?${parts.join("&")}`;
}

async function fetchPage(
  city: string,
  state: string,
  naicsCode: string,
  offset: number
): Promise<SamEntityResponse> {
  const url = buildUrl({
    physicalAddressCity: city,
    physicalAddressStateOrProvinceCode: state,
    primaryNaics: naicsCode,
    registrationStatus: "A",  // Active only
    limit: String(PAGE_SIZE),
    offset: String(offset),
    // Request all sections we need
    includeSections: "entityRegistration,coreData,assertions,pointsOfContact",
  });

  const debugUrl = url.replace(/api_key=[^&]+/, "api_key=REDACTED");

  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (res.status === 429) {
      console.warn(`[SAM Entity] 429 rate limit on attempt ${attempt}. Waiting ${RETRY_DELAY_MS}ms…`);
      if (attempt === 1) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      throw Object.assign(new Error("SAM rate limit (429)"), { status: 429 });
    }

    if (!res.ok) {
      const body = await res.text();
      console.error(`[SAM Entity] HTTP ${res.status} — ${debugUrl}\n${body.slice(0, 300)}`);
      throw Object.assign(new Error(`SAM HTTP ${res.status}`), {
        status: res.status,
        body: body.slice(0, 500),
      });
    }

    return res.json() as Promise<SamEntityResponse>;
  }

  throw new Error("Unreachable");
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface FetchEntitiesOptions {
  city: string;
  state: string;
  naicsCode: string;
  /** Called after each page with running count */
  onProgress?: (fetched: number, total: number) => void;
}

/**
 * Fetch ALL entities for a single city/state/naics combination.
 * Paginates automatically until all records are retrieved.
 */
export async function fetchEntitiesForNaics(
  opts: FetchEntitiesOptions
): Promise<SamEntityData[]> {
  const { city, state, naicsCode, onProgress } = opts;
  const all: SamEntityData[] = [];
  let offset = 0;
  let total = 0;

  do {
    if (offset > 0) await sleep(REQUEST_DELAY_MS);

    const page = await fetchPage(city, state, naicsCode, offset);
    total = page.totalRecords ?? 0;
    const entities = page.entityData ?? [];
    all.push(...entities);
    offset += entities.length;

    onProgress?.(all.length, total);

    if (entities.length === 0) break; // safety: no more data
  } while (all.length < total);

  return all;
}

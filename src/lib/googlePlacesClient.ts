/**
 * Google Places API client.
 *
 * Uses two endpoints:
 *   1. Text Search  — finds place IDs from a text query
 *   2. Place Details — fetches website + address for a specific place_id
 *
 * Cost notes (as of 2024):
 *   - Text Search:  ~$0.032 per request (returns up to 20 results)
 *   - Place Details (Contact fields): ~$0.017 per request
 *   A full sync of 6 queries × 3 pages + ~360 detail calls ≈ $6–$7 per sync.
 *
 * Rate limit notes:
 *   - next_page_token becomes valid only after ~2 seconds
 *   - We apply a 2.5-second delay before using page tokens to be safe
 */

const PLACES_BASE = "https://maps.googleapis.com/maps/api/place";
const API_KEY = process.env.GOOGLE_PLACES_API_KEY ?? "";

// Miami center for location bias (biases results without hard-restricting them)
const MIAMI_LAT = "25.7617";
const MIAMI_LNG = "-80.1918";
const MIAMI_RADIUS = "50000"; // 50 km

const PAGE_TOKEN_DELAY_MS = 2_500; // Google requires ~2s before page token is valid
const REQUEST_DELAY_MS    = 300;   // polite gap between non-paginated calls

// ─── Response types ───────────────────────────────────────────────────────────

export interface PlacesTextSearchResult {
  place_id: string;
  name: string;
  formatted_address: string;
  types: string[];
}

interface TextSearchResponse {
  status: string;
  results: PlacesTextSearchResult[];
  next_page_token?: string;
  error_message?: string;
}

export interface AddressComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

export interface PlaceDetails {
  place_id: string;
  name: string;
  formatted_address: string;
  website?: string;
  address_components?: AddressComponent[];
}

interface PlaceDetailsResponse {
  status: string;
  result: PlaceDetails;
  error_message?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function checkStatus(status: string, error_message?: string, url?: string): void {
  if (status === "OK" || status === "ZERO_RESULTS") return;
  if (status === "REQUEST_DENIED") {
    throw Object.assign(
      new Error(`Google Places API key rejected (REQUEST_DENIED)${error_message ? ": " + error_message : ""}. Check GOOGLE_PLACES_API_KEY in .env.local.`),
      { status: 403 }
    );
  }
  if (status === "OVER_QUERY_LIMIT") {
    throw Object.assign(
      new Error("Google Places API quota exceeded (OVER_QUERY_LIMIT). Check your billing account."),
      { status: 429 }
    );
  }
  throw new Error(`Google Places API error: ${status}${error_message ? " — " + error_message : ""}${url ? ` [${url}]` : ""}`);
}

// ─── Text Search ──────────────────────────────────────────────────────────────

/**
 * Fetch one page of Text Search results.
 * Pass pageToken to get subsequent pages.
 */
async function fetchTextSearchPage(
  query: string,
  pageToken?: string
): Promise<TextSearchResponse> {
  const url = new URL(`${PLACES_BASE}/textsearch/json`);

  if (pageToken) {
    url.searchParams.set("pagetoken", pageToken);
  } else {
    url.searchParams.set("query",    query);
    url.searchParams.set("location", `${MIAMI_LAT},${MIAMI_LNG}`);
    url.searchParams.set("radius",   MIAMI_RADIUS);
    url.searchParams.set("type",     "establishment");
  }
  url.searchParams.set("key", API_KEY);

  const res  = await fetch(url.toString(), { cache: "no-store" });
  const json = await res.json() as TextSearchResponse;
  checkStatus(json.status, json.error_message);
  return json;
}

/**
 * Fetch ALL pages of Text Search results for a query.
 * Returns an array of place stubs (no website yet — that requires Place Details).
 */
export async function textSearchAll(query: string): Promise<PlacesTextSearchResult[]> {
  const all: PlacesTextSearchResult[] = [];
  let pageToken: string | undefined;

  do {
    if (pageToken) await sleep(PAGE_TOKEN_DELAY_MS); // required delay before page token is valid

    const page = await fetchTextSearchPage(query, pageToken);
    all.push(...(page.results ?? []));
    pageToken = page.next_page_token;

    if (!pageToken) break;
    // Limit to 3 pages (60 results) per query to control costs
    if (all.length >= 60) break;
  } while (pageToken);

  return all;
}

// ─── Place Details ────────────────────────────────────────────────────────────

/**
 * Fetch Place Details for a single place_id.
 * Requests only the fields we need to minimise billing cost.
 * Fields:
 *   - name, place_id, formatted_address → Basic Data ($0.017/req)
 *   - website                           → Contact Data (adds ~$0.003/req)
 *   - address_components                → Basic Data
 */
export async function fetchPlaceDetails(placeId: string): Promise<PlaceDetails | null> {
  const url = new URL(`${PLACES_BASE}/details/json`);
  url.searchParams.set("place_id", placeId);
  url.searchParams.set("fields",   "place_id,name,formatted_address,website,address_components");
  url.searchParams.set("key",      API_KEY);

  await sleep(REQUEST_DELAY_MS);

  const res  = await fetch(url.toString(), { cache: "no-store" });
  const json = await res.json() as PlaceDetailsResponse;

  if (json.status === "NOT_FOUND" || json.status === "ZERO_RESULTS") return null;
  checkStatus(json.status, json.error_message);

  return json.result ?? null;
}

export function placesKeyConfigured(): boolean {
  return Boolean(API_KEY) && API_KEY !== "PASTE_YOUR_GOOGLE_PLACES_API_KEY_HERE";
}

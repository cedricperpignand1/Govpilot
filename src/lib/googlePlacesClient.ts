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

const PAGE_TOKEN_DELAY_MS = 5_000; // Google requires ~2s before page token is valid; 5s is safer
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

async function fetchWithTimeout(url: string, timeoutMs = 10_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { cache: "no-store", signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
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

export interface LocationBias {
  lat: string;
  lng: string;
  radius: string;
}

/**
 * Fetch one page of Text Search results.
 * Pass pageToken to get subsequent pages.
 * Pass bias to apply a location bias (optional — omit for global searches).
 */
async function fetchTextSearchPage(
  query: string,
  pageToken?: string,
  bias?: LocationBias,
): Promise<TextSearchResponse> {
  const url = new URL(`${PLACES_BASE}/textsearch/json`);

  if (pageToken) {
    url.searchParams.set("pagetoken", pageToken);
  } else {
    url.searchParams.set("query", query);
    if (bias) {
      url.searchParams.set("location", `${bias.lat},${bias.lng}`);
      url.searchParams.set("radius",   bias.radius);
    }
  }
  url.searchParams.set("key", API_KEY);

  const res  = await fetchWithTimeout(url.toString());
  const json = await res.json() as TextSearchResponse;
  checkStatus(json.status, json.error_message);
  return json;
}

/**
 * Fetch ALL pages of Text Search results for a query.
 * Returns an array of place stubs (no website yet — that requires Place Details).
 * Pass bias to apply a location bias (optional).
 */
export async function textSearchAll(query: string, bias?: LocationBias): Promise<PlacesTextSearchResult[]> {
  const all: PlacesTextSearchResult[] = [];
  let pageToken: string | undefined;

  do {
    if (pageToken) await sleep(PAGE_TOKEN_DELAY_MS);

    try {
      const page = await fetchTextSearchPage(query, pageToken, bias);
      all.push(...(page.results ?? []));
      pageToken = page.next_page_token;
    } catch (err) {
      if (pageToken) {
        // Page token INVALID_REQUEST is common — retry up to 3 more times with extra delay
        let fetched = false;
        for (let pt = 1; pt <= 3; pt++) {
          await sleep(3_000 * pt);
          try {
            const page = await fetchTextSearchPage(query, pageToken, bias);
            all.push(...(page.results ?? []));
            pageToken = page.next_page_token;
            fetched = true;
            break;
          } catch { /* keep retrying */ }
        }
        if (!fetched) {
          console.warn(`[places] Page token failed after retries, returning ${all.length} results so far.`);
          break;
        }
      } else {
        throw err; // first page failed — let withRetry handle it
      }
    }

    if (!pageToken) break;
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

  const res  = await fetchWithTimeout(url.toString());
  const json = await res.json() as PlaceDetailsResponse;

  if (json.status === "NOT_FOUND" || json.status === "ZERO_RESULTS") return null;
  checkStatus(json.status, json.error_message);

  return json.result ?? null;
}

export function placesKeyConfigured(): boolean {
  return Boolean(API_KEY) && API_KEY !== "PASTE_YOUR_GOOGLE_PLACES_API_KEY_HERE";
}

// ─── Geocoding ────────────────────────────────────────────────────────────────

interface GeocodeResponse {
  status: string;
  results: Array<{
    geometry: {
      location: { lat: number; lng: number };
    };
    types: string[];
  }>;
}

/**
 * Convert a location string (e.g. "Miami", "New York", "FL") to lat/lng.
 * Uses the Geocoding API — same key, ~$0.005/request.
 * Returns null if the location cannot be resolved.
 */
export async function geocodeLocation(location: string): Promise<LocationBias | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", location);
  url.searchParams.set("key",     API_KEY);

  try {
    const res  = await fetchWithTimeout(url.toString());
    const json = await res.json() as GeocodeResponse;

    if (json.status !== "OK" || !json.results.length) return null;

    const { lat, lng } = json.results[0].geometry.location;

    // Choose radius based on result type — bigger area for states/countries, tighter for cities
    const types = json.results[0].types ?? [];
    let radius = "50000"; // 50 km default (city)
    if (types.some((t) => ["administrative_area_level_1", "country"].includes(t))) {
      radius = "300000"; // 300 km for states/countries
    }

    return { lat: String(lat), lng: String(lng), radius };
  } catch {
    return null;
  }
}

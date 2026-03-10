/**
 * Search configuration for the Miami construction company Google Places sync.
 *
 * Architecture:
 *   The sync generates all (trade × locality) query combinations plus optional
 *   ZIP-based queries, then caps at MAX_QUERIES_PER_SYNC to control cost.
 *
 * Cost estimate (Google Places API, 2024 pricing):
 *   Text Search:  ~$0.032 per request (up to 60 results via 3 pages)
 *   Place Details: ~$0.017 per request (+ ~$0.003 for website/contact field)
 *   100 queries ≈ $3.20 text + (1,500 new places × $0.017) ≈ $28.70
 *   300 queries ≈ $9.60 text + (4,000 new places × $0.017) ≈ $77.60
 *   Subsequent runs are cheaper — already-seen place_ids skip the detail call.
 *
 * To expand to all Florida later:
 *   1. Replace LOCALITIES with Florida city list (or keep Miami + add FL cities)
 *   2. Replace MIAMI_DADE_ZIPS with Florida ZIP codes
 *   3. Update MIAMI_CENTER_LAT / MIAMI_CENTER_LNG in googlePlacesClient.ts
 *      to a Florida geographic center (e.g., 27.6648, -81.5158)
 *   4. Increase MIAMI_RADIUS to 400000 (400 km) in googlePlacesClient.ts
 *   5. Increase MAX_QUERIES_PER_SYNC to 800+
 */

// ─── Trade / category search terms ────────────────────────────────────────────
// Ordered from broadest / highest-yield to most specific.
// The sync generates queries in TRADE order × LOCALITY order, so broad trades
// get full geographic coverage before specific ones are processed.
export const TRADES: string[] = [
  "construction company",
  "general contractor",
  "commercial contractor",
  "residential contractor",
  "remodeling contractor",
  "home builder",
  "roofing contractor",
  "plumber",
  "plumbing contractor",
  "electrical contractor",
  "electrician",
  "hvac contractor",
  "air conditioning contractor",
  "concrete contractor",
  "masonry contractor",
  "painting contractor",
  "flooring contractor",
  "kitchen remodeling",
  "bathroom remodeling",
  "drywall contractor",
  "demolition contractor",
  "window contractor",
  "door contractor",
  "glass contractor",
  "paving contractor",
  "asphalt contractor",
  "framing contractor",
  "stucco contractor",
  "waterproofing contractor",
  "insulation contractor",
  "landscaping contractor",
  "pool contractor",
];

// ─── Miami-area localities ────────────────────────────────────────────────────
// Each locality is combined with every trade to form a unique search window.
// Adding a locality here adds TRADES.length more queries per sync.
// To expand to all FL: add additional Florida cities below.
export const LOCALITIES: string[] = [
  "Miami",
  "Miami Beach",
  "North Miami",
  "North Miami Beach",
  "Hialeah",
  "Doral",
  "Kendall",
  "Coral Gables",
  "South Miami",
  "Pinecrest",
  "Palmetto Bay",
  "Homestead",
  "Cutler Bay",
  "Aventura",
  "Sunny Isles Beach",
  "Miami Gardens",
];

// ─── Miami-Dade representative ZIP codes ─────────────────────────────────────
// ZIP-based queries surface companies in areas that don't respond well to
// city-name searches (industrial zones, unincorporated areas, etc.).
// Spread across different quadrants of Miami-Dade for geographic diversity.
// To expand to all FL: add ZIP codes for other FL metro areas (Jacksonville,
// Tampa, Orlando, Fort Lauderdale, etc.).
export const MIAMI_DADE_ZIPS: string[] = [
  // Downtown / Brickell / Little Havana
  "33101", "33125", "33126", "33127", "33128", "33129", "33130",
  "33131", "33132", "33133", "33135", "33136", "33137", "33138",
  // NW Miami-Dade (Hialeah / Doral area)
  "33142", "33144", "33145", "33146", "33147", "33150", "33155",
  // South Miami / Kendall
  "33156", "33157", "33165", "33166", "33174", "33175", "33176",
  "33177", "33183", "33184", "33185", "33186", "33187",
  // North Miami-Dade (Aventura / Opa-locka / Miami Gardens)
  "33160", "33161", "33162", "33167", "33168", "33169",
  "33178", "33179", "33180", "33181", "33182",
  // South-west and far south (Homestead / Cutler Bay / Palmetto Bay)
  "33170", "33172", "33189", "33190", "33193", "33194", "33196",
];

// ─── Trades used for ZIP-based queries ───────────────────────────────────────
// ZIP queries are supplementary and expensive (ZIPs × trades queries).
// Use only the highest-yield categories to control cost.
// Extend this list to get more ZIP coverage per trade.
export const ZIP_QUERY_TRADES: string[] = [
  "construction company",
  "general contractor",
  "roofing contractor",
  "electrical contractor",
  "plumbing contractor",
  "hvac contractor",
  "painting contractor",
  "flooring contractor",
];

// ─── Relevance filtering ──────────────────────────────────────────────────────
/**
 * Google Places `types` values that indicate a result is clearly NOT a
 * construction or trade business. Any place whose types array contains one of
 * these will be filtered out before fetching expensive Place Details.
 */
export const EXCLUDE_PLACE_TYPES: string[] = [
  // Food & drink
  "restaurant", "food", "meal_delivery", "meal_takeaway",
  "cafe", "bakery", "bar", "night_club", "liquor_store",
  // Health / personal services
  "hospital", "doctor", "dentist", "pharmacy", "health",
  "beauty_salon", "hair_care", "spa",
  // Education
  "school", "university", "primary_school", "secondary_school",
  // Accommodation
  "lodging",
  // Fitness / recreation
  "gym", "stadium",
  // Retail / shopping
  "grocery_or_supermarket", "supermarket", "convenience_store",
  "clothing_store", "department_store", "shopping_mall", "store",
  "home_goods_store", "furniture_store", "electronics_store",
  // Auto
  "gas_station", "car_dealer", "car_wash", "car_repair",
  // Finance / legal
  "bank", "atm", "accounting",
  // Religion / civic
  "church", "place_of_worship", "cemetery", "courthouse",
  // Entertainment / tourism
  "museum", "art_gallery", "movie_theater", "amusement_park",
  "tourist_attraction", "zoo",
  // Transport
  "travel_agency", "transit_station", "bus_station", "subway_station",
  "airport",
  // Other non-construction
  "laundry", "dry_cleaning", "post_office",
];

/**
 * Company name substrings that strongly indicate a non-construction business.
 * Checked case-insensitively against the place name from Text Search results.
 * Add to this list if you see irrelevant results slipping through.
 */
export const EXCLUDE_NAME_KEYWORDS: string[] = [
  // Food
  "restaurant", "cafe", "coffee", "starbucks", "mcdonald", "pizza",
  "sushi", "grill", "burger", "taco", "diner", "bakery",
  // Medical
  "hospital", "clinic", "urgent care", "medical center", "dental",
  "pharmacy", "walgreens", "cvs",
  // Education
  "school", "academy", "college", "university", "learning center",
  // Lodging
  "hotel", "motel", "inn", "resort", "suites",
  // Personal care
  "salon", "barber", "beauty", "nails", "spa", "massage",
  // Fitness
  "gym", "fitness", "crossfit", "yoga",
  // Grocery / retail
  "supermarket", "grocery", "walmart", "target", "publix",
  "costco", "whole foods",
  // Finance / legal
  "bank", "wells fargo", "chase bank", "citibank",
  "law firm", "attorney", "legal services",
  // Auto (non-construction)
  "car dealership", "auto dealer", "car wash",
  // Religion
  "church", "temple", "mosque", "synagogue",
  // Entertainment
  "museum", "theater", "cinema",
];

// ─── Query generation limits ──────────────────────────────────────────────────
/**
 * Maximum number of Google Text Search queries to run per sync.
 * Full coverage = TRADES.length × LOCALITIES.length = 32 × 16 = 512 locality
 * queries + ZIP_QUERY_TRADES.length × MIAMI_DADE_ZIPS.length = 8 × 43 = 344
 * ZIP queries = 856 total. Set MAX_QUERIES_PER_SYNC below that to run in
 * batches across multiple sync presses.
 *
 * Recommended values:
 *   50  → fast test run, ~$2–5, covers core trades × Miami only
 *   150 → good first sync, ~$5–15, covers core trades × all localities
 *   300 → deep run, ~$15–40, covers all trades × all localities
 *   512 → full locality pass, all (trade × locality) combinations
 *   856 → complete pass, includes all ZIP queries too (expensive)
 */
export const MAX_QUERIES_PER_SYNC = 300;

/**
 * Whether to include ZIP-code-based queries (trade + ZIP number).
 * ZIP queries catch companies that don't surface in city-name searches
 * (e.g., industrial parks, unincorporated areas).
 * These are added AFTER locality queries in the queue, so they only
 * run if MAX_QUERIES_PER_SYNC is large enough.
 */
export const ENABLE_ZIP_QUERIES = true;

/**
 * Milliseconds to wait between text search query batches.
 * Google Places allows high QPS but we pace conservatively.
 */
export const INTER_QUERY_DELAY_MS = 300;

/**
 * Milliseconds to wait before retrying a failed (non-quota) request.
 */
export const RETRY_BASE_DELAY_MS = 2_000;

/**
 * Maximum retry attempts for transient errors (network timeouts, 5xx).
 * 429 and 403 are never retried — they stop the sync immediately.
 */
export const MAX_RETRIES = 2;

import { NextRequest, NextResponse } from "next/server";
import { cache, CACHE_TTL_MS } from "@/lib/cache";
import { SamApiResponse } from "@/lib/types";
import { todayForSam, daysAgo } from "@/lib/defaults";

const SAM_BASE = process.env.SAM_BASE_URL ?? "https://api.sam.gov";
const SAM_KEY = process.env.SAM_API_KEY ?? "";

/**
 * Build the SAM.gov query string manually.
 *
 * IMPORTANT: Do NOT use URLSearchParams for date fields — it encodes slashes
 * as %2F (e.g. 02%2F19%2F2026) and SAM.gov requires literal slashes.
 *
 * NAICS (ncode) and ptype are intentionally NOT sent to SAM because the API
 * only accepts a single value for each, and sending multiple causes 404.
 * Those filters are applied client-side via the scoring function instead.
 */
function buildSamUrl(searchParams: URLSearchParams): string {
  const postedFrom = searchParams.get("postedFrom") ?? daysAgo(14);
  const postedTo = searchParams.get("postedTo") ?? todayForSam();
  const limit = searchParams.get("limit") ?? "100";
  const offset = searchParams.get("offset") ?? "0";

  const parts: string[] = [
    `api_key=${encodeURIComponent(SAM_KEY)}`,
    `postedFrom=${postedFrom}`,  // literal slashes required by SAM
    `postedTo=${postedTo}`,
    `limit=${limit}`,
    `offset=${offset}`,
  ];

  // Single-value optional filters that SAM handles fine
  const state = searchParams.get("state");
  if (state) parts.push(`state=${encodeURIComponent(state)}`);

  const title = searchParams.get("title");
  if (title) parts.push(`title=${encodeURIComponent(title)}`);

  const solnum = searchParams.get("solnum");
  if (solnum) parts.push(`solnum=${encodeURIComponent(solnum)}`);

  const orgName = searchParams.get("organizationName");
  if (orgName) parts.push(`organizationName=${encodeURIComponent(orgName)}`);

  // NOTE: ncode and ptype are deliberately omitted here.
  // SAM only accepts one value per param and multiple values cause 404.
  // NAICS and procurement-type filtering happens client-side via scoring.

  return `${SAM_BASE}/opportunities/v2/search?${parts.join("&")}`;
}

// In-flight deduplication: if an identical request is already pending, reuse it
const globalForInflight = global as typeof global & {
  _govInflight?: Map<string, Promise<SamApiResponse>>;
};
const inflight: Map<string, Promise<SamApiResponse>> =
  globalForInflight._govInflight ??
  (globalForInflight._govInflight = new Map());

export async function GET(req: NextRequest) {
  if (!SAM_KEY || SAM_KEY === "PASTE_YOUR_SAM_GOV_API_KEY_HERE") {
    return NextResponse.json(
      { error: "SAM_API_KEY is not configured. Add it to .env.local." },
      { status: 500 }
    );
  }

  const sp = req.nextUrl.searchParams;
  const samUrl = buildSamUrl(sp);
  const debugUrl = samUrl.replace(/api_key=[^&]+/, "api_key=REDACTED");

  const cached = cache.get<SamApiResponse>(debugUrl);
  if (cached) {
    return NextResponse.json({ ...cached, _cached: true });
  }

  // If an identical fetch is already in-flight, wait for it instead of firing another
  if (inflight.has(debugUrl)) {
    try {
      const data = await inflight.get(debugUrl)!;
      return NextResponse.json({ ...data, _cached: true });
    } catch {
      // fall through to a fresh attempt
    }
  }

  // Register the in-flight promise so concurrent identical requests share it
  const fetchPromise: Promise<SamApiResponse> = fetch(samUrl, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  }).then(async (res) => {
    if (!res.ok) {
      const text = await res.text();
      // Attach status to the error so the catch block can surface it
      const err = Object.assign(new Error(text.slice(0, 500)), { status: res.status, body: text });
      throw err;
    }
    return res.json() as Promise<SamApiResponse>;
  });

  inflight.set(debugUrl, fetchPromise);

  try {
    const data = await fetchPromise;
    cache.set(debugUrl, data, CACHE_TTL_MS);
    cache.prune();
    return NextResponse.json(data);
  } catch (err: unknown) {
    const status = (err as { status?: number }).status ?? 502;
    const body = (err as { body?: string }).body ?? String(err);
    console.error("[SAM API error]", status, debugUrl, "\n", body.slice(0, 200));

    let hint = "";
    if (status === 404) {
      hint =
        " — 404 usually means your API key is a Personal key. " +
        "SAM.gov v2 requires a System Account key with 'Contract Opportunities Reader' role.";
    } else if (status === 401 || status === 403) {
      hint = " — API key rejected. Check it in .env.local and restart the server.";
    }

    return NextResponse.json(
      { error: `SAM API returned ${status}${hint}`, detail: body.slice(0, 500), _debugUrl: debugUrl },
      { status }
    );
  } finally {
    inflight.delete(debugUrl);
  }
}

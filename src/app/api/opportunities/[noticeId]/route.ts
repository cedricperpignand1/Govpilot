import { NextRequest, NextResponse } from "next/server";
import { cache, CACHE_TTL_DETAIL_MS } from "@/lib/cache";
import { SamApiResponse } from "@/lib/types";

const SAM_BASE = process.env.SAM_BASE_URL ?? "https://api.sam.gov";
const SAM_KEY = process.env.SAM_API_KEY ?? "";

export async function GET(
  _req: NextRequest,
  { params }: { params: { noticeId: string } }
) {
  if (!SAM_KEY || SAM_KEY === "PASTE_YOUR_SAM_GOV_API_KEY_HERE") {
    return NextResponse.json(
      { error: "SAM_API_KEY is not configured. Add it to .env.local." },
      { status: 500 }
    );
  }

  const { noticeId } = params;
  if (!noticeId) {
    return NextResponse.json({ error: "noticeId is required" }, { status: 400 });
  }

  const cacheKey = `detail:${noticeId}`;
  const cached = cache.get<SamApiResponse>(cacheKey);
  if (cached) {
    return NextResponse.json({ ...cached, _cached: true });
  }

  // SAM enforces a max 1-year date range — use 364 days ago → today.
  // Literal slashes required (URLSearchParams would encode them as %2F).
  const today = formatDate(new Date());
  const yearAgo = formatDate(daysAgo(364));

  const samUrl = [
    `${SAM_BASE}/opportunities/v2/search`,
    `?api_key=${encodeURIComponent(SAM_KEY)}`,
    `&noticeid=${encodeURIComponent(noticeId)}`,
    `&postedFrom=${yearAgo}`,
    `&postedTo=${today}`,
    `&limit=10`,
    `&offset=0`,
  ].join("");

  try {
    const res = await fetch(samUrl, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `SAM API returned ${res.status}`, detail: text.slice(0, 300) },
        { status: res.status }
      );
    }

    const data = (await res.json()) as SamApiResponse;
    cache.set(cacheKey, data, CACHE_TTL_DETAIL_MS);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to reach SAM.gov API", detail: String(err) },
      { status: 502 }
    );
  }
}

function formatDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

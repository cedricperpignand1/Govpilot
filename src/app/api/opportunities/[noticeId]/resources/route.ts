import { NextRequest, NextResponse } from "next/server";

const SAM_BASE = process.env.SAM_BASE_URL ?? "https://api.sam.gov";
const SAM_KEY = process.env.SAM_API_KEY ?? "";

function formatDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
}

// The v1/resources endpoint is not accessible with a System Account key.
// Instead, fetch the opportunity from the v2 search API and extract
// the resourceLinks array that SAM embeds in each opportunity object.
export async function GET(
  _req: NextRequest,
  { params }: { params: { noticeId: string } }
) {
  if (!SAM_KEY || SAM_KEY === "PASTE_YOUR_SAM_GOV_API_KEY_HERE") {
    return NextResponse.json({ error: "SAM_API_KEY not configured" }, { status: 500 });
  }

  const { noticeId } = params;
  const today = formatDate(new Date());
  const yearAgo = formatDate(new Date(Date.now() - 364 * 86400_000));

  const samUrl = [
    `${SAM_BASE}/opportunities/v2/search`,
    `?api_key=${encodeURIComponent(SAM_KEY)}`,
    `&noticeid=${encodeURIComponent(noticeId)}`,
    `&postedFrom=${yearAgo}`,
    `&postedTo=${today}`,
    `&limit=1`,
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
        { error: `SAM returned ${res.status}`, detail: text.slice(0, 300) },
        { status: res.status }
      );
    }

    const data = await res.json();
    const opp = data.opportunitiesData?.[0] ?? {};
    const resourceLinks: string[] = opp.resourceLinks ?? [];

    console.log("[resources] resourceLinks:", resourceLinks);

    return NextResponse.json({ resourceLinks });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to fetch resources", detail: String(err) },
      { status: 502 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";

const SAM_BASE = process.env.SAM_BASE_URL ?? "https://api.sam.gov";
const SAM_KEY = process.env.SAM_API_KEY ?? "";

export async function GET(
  _req: NextRequest,
  { params }: { params: { resourceId: string } }
) {
  if (!SAM_KEY || SAM_KEY === "PASTE_YOUR_SAM_GOV_API_KEY_HERE") {
    return NextResponse.json({ error: "SAM_API_KEY not configured" }, { status: 500 });
  }

  const { resourceId } = params;
  const url = `${SAM_BASE}/opportunities/v1/resources/files/download/${encodeURIComponent(resourceId)}?api_key=${encodeURIComponent(SAM_KEY)}`;

  try {
    const res = await fetch(url, {
      headers: { Accept: "*/*" },
      redirect: "follow",
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `SAM returned ${res.status}` },
        { status: res.status }
      );
    }

    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    const contentDisposition = res.headers.get("content-disposition");
    const body = await res.arrayBuffer();

    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=300",
    };
    if (contentDisposition) {
      headers["Content-Disposition"] = contentDisposition;
    }

    return new NextResponse(body, { status: 200, headers });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to download resource", detail: String(err) },
      { status: 502 }
    );
  }
}

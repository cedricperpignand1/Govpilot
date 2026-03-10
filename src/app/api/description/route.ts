import { NextRequest, NextResponse } from "next/server";

const SAM_KEY = process.env.SAM_API_KEY ?? "";

/**
 * Proxy route for SAM.gov description/attachment package URLs.
 *
 * The `description` field returned by the SAM API is an API endpoint that
 * requires the api_key query param. We can't put the key in browser-facing
 * links, so this route adds it server-side and streams the response back.
 *
 * Usage: GET /api/description?url=<encoded_sam_description_url>
 */
export async function GET(req: NextRequest) {
  const rawUrl = req.nextUrl.searchParams.get("url");
  if (!rawUrl) {
    return NextResponse.json({ error: "url param required" }, { status: 400 });
  }

  // Only allow proxying to api.sam.gov to prevent open-redirect abuse
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 });
  }

  if (!target.hostname.endsWith("sam.gov")) {
    return NextResponse.json({ error: "Only sam.gov URLs are allowed" }, { status: 403 });
  }

  // Add the API key server-side
  target.searchParams.set("api_key", SAM_KEY);

  try {
    const res = await fetch(target.toString(), {
      headers: { Accept: "*/*" },
      // Follow redirects (SAM often redirects to S3 for the actual file)
      redirect: "follow",
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `SAM returned ${res.status} for description URL` },
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
      { error: "Failed to fetch description", detail: String(err) },
      { status: 502 }
    );
  }
}

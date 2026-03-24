export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { Redis } from "@upstash/redis";
import { NextRequest, NextResponse } from "next/server";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const HASH_KEY = "saved_opportunities";

// GET /api/saved-opportunities
export async function GET() {
  try {
    const all = await redis.hgetall<Record<string, string>>(HASH_KEY);
    if (!all) return NextResponse.json([]);

    const opps = Object.values(all).map((v) => {
      try { return typeof v === "string" ? JSON.parse(v) : v; } catch { return null; }
    }).filter(Boolean);

    return NextResponse.json(opps);
  } catch (err) {
    console.error("[saved opps] GET error:", err);
    return NextResponse.json([], { status: 500 });
  }
}

// POST /api/saved-opportunities  body: { opportunity }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const opp = body?.opportunity;
    if (!opp?.noticeId) {
      return NextResponse.json({ error: "Missing noticeId" }, { status: 400 });
    }

    await redis.hset(HASH_KEY, { [opp.noticeId]: JSON.stringify(opp) });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[saved opps] POST error:", err);
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
}

// DELETE /api/saved-opportunities?noticeId=xxx
export async function DELETE(req: NextRequest) {
  try {
    const noticeId = req.nextUrl.searchParams.get("noticeId");
    if (!noticeId) {
      return NextResponse.json({ error: "Missing noticeId" }, { status: 400 });
    }

    await redis.hdel(HASH_KEY, noticeId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[saved opps] DELETE error:", err);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

// GET /api/saved-opportunities → return all saved opportunities
export async function GET() {
  const rows = db
    .prepare("SELECT payload FROM saved_opportunities ORDER BY savedAt DESC")
    .all() as { payload: string }[];

  const opps = rows.map((r) => {
    try { return JSON.parse(r.payload); } catch { return null; }
  }).filter(Boolean);

  return NextResponse.json(opps);
}

// POST /api/saved-opportunities  body: { opportunity }  → upsert (save)
export async function POST(req: NextRequest) {
  const body = await req.json();
  const opp = body?.opportunity;
  if (!opp?.noticeId) {
    return NextResponse.json({ error: "Missing noticeId" }, { status: 400 });
  }

  db.prepare(
    `INSERT INTO saved_opportunities (noticeId, payload)
     VALUES (?, ?)
     ON CONFLICT(noticeId) DO UPDATE SET payload = excluded.payload, savedAt = datetime('now')`
  ).run(opp.noticeId, JSON.stringify(opp));

  return NextResponse.json({ ok: true });
}

// DELETE /api/saved-opportunities?noticeId=xxx → remove
export async function DELETE(req: NextRequest) {
  const noticeId = req.nextUrl.searchParams.get("noticeId");
  if (!noticeId) {
    return NextResponse.json({ error: "Missing noticeId" }, { status: 400 });
  }

  db.prepare("DELETE FROM saved_opportunities WHERE noticeId = ?").run(noticeId);
  return NextResponse.json({ ok: true });
}

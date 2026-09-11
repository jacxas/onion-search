import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { CRAWL_MODE } from "@/lib/tor/transport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.execute(sql`SELECT 1`);
    return NextResponse.json({ ok: true, db: "up", mode: CRAWL_MODE });
  } catch (e) {
    return NextResponse.json(
      { ok: false, db: "down", error: e instanceof Error ? e.message : "?" },
      { status: 503 },
    );
  }
}

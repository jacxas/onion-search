import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  let dbOk = false;
  try {
    await db().execute(sql`SELECT 1`);
    dbOk = true;
  } catch {
    dbOk = false;
  }
  let pending: number | null = null;
  if (dbOk) {
    try {
      const res = await db().execute(sql`SELECT count(*)::int AS n FROM crawl_queue WHERE status = 'pending'`);
      pending = Number((res.rows[0] as Record<string, unknown>).n ?? 0);
    } catch {
      pending = null;
    }
  }
  const cfg = getConfig();
  return NextResponse.json(
    {
      status: dbOk ? "ok" : "degraded",
      db: dbOk,
      mode: cfg.crawlMode,
      pendingQueue: pending,
      elapsedMs: Date.now() - started,
    },
    { status: dbOk ? 200 : 503 }
  );
}

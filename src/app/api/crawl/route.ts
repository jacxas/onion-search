import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { runPipeline } from "@/crawler/pipeline";
import { healthSweep } from "@/crawler/health";
import { getTransport } from "@/lib/tor/transport";
import { alertTransitions } from "@/lib/mail";

export const dynamic = "force-dynamic";

/** GET: estado de la cola de rastreo (público, de solo lectura). */
export async function GET() {
  const res = await db().execute(sql`
    SELECT status, count(*)::int AS n FROM crawl_queue GROUP BY status
  `);
  const last = await db().execute(sql`SELECT max(last_crawled_at) AS "last" FROM sites`);
  return NextResponse.json({
    queue: res.rows,
    lastCrawlAt: (last.rows[0] as Record<string, unknown>).last ?? null,
  });
}

/** POST: dispara un lote de crawl + health (requiere admin: sesión o token). */
export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.error === "csrf" ? 403 : 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { maxPages?: number };
  const summary = await runPipeline({ maxPages: Math.min(body.maxPages ?? 30, 100) });
  const sweep = await healthSweep(getTransport(), { limit: 20 });
  await alertTransitions(sweep.transitions);
  return NextResponse.json({ crawl: summary, health: { checked: sweep.checked, up: sweep.up, down: sweep.down } });
}

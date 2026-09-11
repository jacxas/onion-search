import { NextRequest, NextResponse } from "next/server";
import {
  ensureSeeded,
  runCrawlBatch,
  runHealthSweep,
  runPipelineOnce,
} from "@/lib/crawler/pipeline";
import { CRAWL_MODE } from "@/lib/tor/transport";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const CSRF_ENABLED = (process.env.CSRF_ENABLED ?? "true").toLowerCase() === "true";

/**
 * Autorización: ADMIN_TOKEN (server-to-server / cron) o sesión admin (cookie).
 * Con CSRF_ENABLED=true, las requests autenticadas por cookie exigen Origin
 * same-origin (las server actions ya traen validación de Origden de Next).
 */
async function authorized(req: NextRequest): Promise<boolean> {
  const token = process.env.ADMIN_TOKEN;
  const tokenOk =
    token &&
    (req.headers.get("x-admin-token") === token ||
      req.nextUrl.searchParams.get("token") === token);
  if (tokenOk) return true;

  const session = await getSession().catch(() => null);
  if (!session) return false;

  if (CSRF_ENABLED) {
    const origin = req.headers.get("origin");
    if (origin) {
      try {
        if (new URL(origin).host !== req.headers.get("host")) return false;
      } catch {
        return false;
      }
    }
  }
  return true;
}

/**
 * POST /api/admin/run { kind?: "pipeline"|"crawl"|"health"|"seed", limit?: number }
 * Dispara el pipeline manualmente (también usable desde cron externo).
 */
export async function POST(req: NextRequest) {
  if (!(await authorized(req))) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }
  let body: { kind?: string; limit?: number } = {};
  try {
    body = await req.json();
  } catch {
    /* body vacío = pipeline */
  }
  const kind = body.kind ?? "pipeline";
  const limit = Math.min(Math.max(Number(body.limit ?? 12) || 12, 1), 50);

  if (kind === "seed") {
    const seeded = await ensureSeeded();
    return NextResponse.json({ kind, seeded, mode: CRAWL_MODE });
  }
  if (kind === "crawl") {
    const crawl = await runCrawlBatch(limit);
    return NextResponse.json({ kind, mode: CRAWL_MODE, crawl });
  }
  if (kind === "health") {
    const health = await runHealthSweep(limit);
    return NextResponse.json({ kind, mode: CRAWL_MODE, health });
  }
  const out = await runPipelineOnce(limit, limit);
  return NextResponse.json({ kind, mode: CRAWL_MODE, ...out });
}

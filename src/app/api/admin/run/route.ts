import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { runPipeline } from "@/crawler/pipeline";
import { healthSweep } from "@/crawler/health";
import { getTransport } from "@/lib/tor/transport";
import { seedQueue } from "@/crawler/queue";
import { alertTransitions } from "@/lib/mail";

export const dynamic = "force-dynamic";

/**
 * POST — disparar acciones del pipeline (cron / server-to-server / ops):
 *   { action: "crawl" | "health" | "seed", maxPages?, seeds? }
 * Auth: sesión de admin (con CSRF same-origin) o ADMIN_TOKEN (header).
 */
export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.error === "csrf" ? 403 : 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    maxPages?: number;
    seeds?: string[];
    limit?: number;
  };
  const action = body.action ?? "crawl";

  if (action === "seed") {
    const seeds = (body.seeds ?? []).filter((s) => typeof s === "string" && s.length > 0);
    if (!seeds.length) return NextResponse.json({ error: "missing_seeds" }, { status: 400 });
    const n = await seedQueue(seeds);
    return NextResponse.json({ ok: true, enqueued: n });
  }

  if (action === "health") {
    const sweep = await healthSweep(getTransport(), { limit: Math.min(body.limit ?? 40, 200) });
    await alertTransitions(sweep.transitions);
    return NextResponse.json({ ok: true, health: sweep });
  }

  if (action === "crawl") {
    const crawl = await runPipeline({ maxPages: Math.min(body.maxPages ?? 60, 200) });
    const sweep = await healthSweep(getTransport(), { limit: 20 });
    await alertTransitions(sweep.transitions);
    return NextResponse.json({ ok: true, crawl, health: { checked: sweep.checked, up: sweep.up, down: sweep.down } });
  }

  return NextResponse.json({ error: "unknown_action" }, { status: 400 });
}

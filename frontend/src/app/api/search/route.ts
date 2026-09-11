import { NextRequest, NextResponse } from "next/server";
import { searchIndex } from "@/lib/search";
import { ensureSeeded } from "@/lib/crawler/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const q = (p.get("q") ?? "").trim().slice(0, 200);
  const page = Math.max(1, Number(p.get("page") ?? 1) || 1);
  const limit = 20;

  if (!q) {
    return NextResponse.json({ results: [], total: 0, tookMs: 0, q, page });
  }

  await ensureSeeded(); // autoseed perezoso en la primera consulta

  const { results, total, tookMs } = await searchIndex(q, {
    limit,
    offset: (page - 1) * limit,
    onlineOnly: p.get("online") === "1",
    minUptime: p.get("uptime80") === "1" ? 0.8 : 0,
  });

  return NextResponse.json({
    results,
    total,
    tookMs,
    q,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
  });
}

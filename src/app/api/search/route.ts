import { NextResponse } from "next/server";
import { searchPages } from "@/lib/search";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const q = (u.searchParams.get("q") ?? "").trim();
  if (!q) return NextResponse.json({ hits: [], total: 0 });
  const limit = Math.min(Number(u.searchParams.get("limit") ?? 20) || 20, 100);
  const offset = Math.max(Number(u.searchParams.get("offset") ?? 0) || 0, 0);
  const onlineOnly = u.searchParams.get("online") === "1";
  const hits = await searchPages(q, { limit, offset, onlineOnly });
  return NextResponse.json({ hits, total: hits.length });
}

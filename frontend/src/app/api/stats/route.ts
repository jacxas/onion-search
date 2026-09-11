import { NextResponse } from "next/server";
import { getStats, getChecksSeries } from "@/lib/search";
import { CRAWL_MODE } from "@/lib/tor/transport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [stats, series] = await Promise.all([getStats(), getChecksSeries()]);
  return NextResponse.json({ mode: CRAWL_MODE, stats, series });
}

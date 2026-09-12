import { NextResponse } from "next/server";
import { db } from "@/db";
import { reports } from "@/db/schema";
import { isOnionUrl } from "@/lib/onion";
import { sendAlert } from "@/lib/mail";

export const dynamic = "force-dynamic";

const REASONS = ["illegal", "scam", "offline", "mirror", "other"];

// rate-limit en memoria (una instancia); el reporte persiste en PostgreSQL
const rate = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 3_600_000;
const MAX = 5;

function allowed(ip: string): boolean {
  const now = Date.now();
  const e = rate.get(ip);
  if (!e || e.resetAt < now) {
    rate.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (e.count >= MAX) return false;
  e.count++;
  return true;
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!allowed(ip)) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const body = (await req.json().catch(() => null)) as {
    url?: string;
    reason?: string;
    details?: string;
    email?: string;
  } | null;
  if (!body?.url || !isOnionUrl(body.url)) {
    return NextResponse.json({ error: "invalid_url" }, { status: 400 });
  }
  const reason = REASONS.includes(body.reason ?? "") ? body.reason! : "other";

  await db().insert(reports).values({
    url: body.url.slice(0, 2000),
    reason,
    details: body.details?.slice(0, 2000) ?? null,
    reporterEmail: body.email?.slice(0, 255) ?? null,
  });
  await sendAlert("report", body.url, `Reporte (${reason}): ${body.url.slice(0, 80)}`, body.details ?? "");
  return NextResponse.json({ ok: true });
}

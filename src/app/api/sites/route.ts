import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const limit = Math.min(Number(u.searchParams.get("limit") ?? 50) || 50, 200);
  const offset = Math.max(Number(u.searchParams.get("offset") ?? 0) || 0, 0);
  const q = (u.searchParams.get("q") ?? "").trim();
  const status = u.searchParams.get("status"); // online|offline|blocked

  const res = await db().execute(sql`
    SELECT s.domain, s.url, s.title, s.online, s.blocked, s.uptime_ratio AS "uptimeRatio",
           s.total_checks AS "totalChecks", s.last_checked_at AS "lastCheckedAt",
           s.last_crawled_at AS "lastCrawledAt",
           (SELECT count(*) FROM pages p WHERE p.site_id = s.id)::int AS "pageCount"
    FROM sites s
    WHERE (${q} = '' OR s.domain ILIKE ${"%" + q + "%"} OR s.title ILIKE ${"%" + q + "%"})
      AND (${status ?? ""} = '' OR ${status ?? ""} = 'all'
           OR (${status ?? ""} = 'online' AND s.online)
           OR (${status ?? ""} = 'offline' AND NOT s.online)
           OR (${status ?? ""} = 'blocked' AND s.blocked))
    ORDER BY s.uptime_ratio DESC, s.domain
    LIMIT ${limit} OFFSET ${offset}
  `);
  return NextResponse.json({ sites: res.rows });
}

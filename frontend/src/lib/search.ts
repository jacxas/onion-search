import { sql } from "drizzle-orm";
import { db } from "@/db";

export interface SearchResult {
  pageId: number;
  url: string;
  title: string;
  description: string;
  crawledAt: string;
  domain: string;
  status: string;
  uptimeRatio: number;
  avgResponseMs: number | null;
  lastCheckedAt: string | null;
  mirrors: number;
  score: number;
}

export interface SearchOptions {
  limit?: number;
  offset?: number;
  onlineOnly?: boolean;
  minUptime?: number;
}

function toIso(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/**
 * Búsqueda full-text en PostgreSQL rankeada por:
 * relevancia textual × (0.4 + uptime) + boost si está en línea − castigo si caído.
 * Espejos (canonical_id) y sitios bloqueados quedan excluidos.
 */
export async function searchIndex(
  q: string,
  opts: SearchOptions = {},
): Promise<{ results: SearchResult[]; total: number; tookMs: number }> {
  const started = Date.now();
  const limit = Math.min(opts.limit ?? 20, 50);
  const offset = opts.offset ?? 0;
  const onlineOnly = opts.onlineOnly ?? false;
  const minUptime = Math.min(Math.max(opts.minUptime ?? 0, 0), 1);

  const vec = sql`to_tsvector('simple', coalesce(p.title,'') || ' ' || coalesce(p.description,'') || ' ' || coalesce(p.content_text,''))`;
  const tsq = sql`websearch_to_tsquery('simple', ${q})`;

  const where = sql`
    ${vec} @@ ${tsq}
    AND s.is_blocked = false
    AND s.canonical_id IS NULL
    AND (${onlineOnly} = false OR s.status = 'online')
    AND s.uptime_ratio >= ${minUptime}
  `;

  const rows = await db.execute(sql`
    SELECT p.id AS page_id, p.url, p.title, p.description, p.crawled_at,
           s.domain, s.status, s.uptime_ratio, s.avg_response_ms, s.last_checked_at,
           (SELECT count(*)::int FROM onion_sites m WHERE m.canonical_id = s.id) AS mirrors,
           (ts_rank_cd(${vec}, ${tsq}) * (0.4 + s.uptime_ratio)
             + CASE WHEN s.status = 'online' THEN 0.20 ELSE -0.50 END) AS score
    FROM pages p
    JOIN onion_sites s ON s.id = p.site_id
    WHERE ${where}
    ORDER BY score DESC, p.crawled_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `);

  const countRows = await db.execute(sql`
    SELECT count(*)::int AS n
    FROM pages p JOIN onion_sites s ON s.id = p.site_id
    WHERE ${where}
  `);

  const results: SearchResult[] = (rows.rows as Record<string, unknown>[]).map((r) => ({
    pageId: Number(r.page_id),
    url: String(r.url),
    title: String(r.title ?? "(sin título)"),
    description: String(r.description ?? ""),
    crawledAt: toIso(r.crawled_at) ?? "",
    domain: String(r.domain),
    status: String(r.status),
    uptimeRatio: Number(r.uptime_ratio ?? 0),
    avgResponseMs: r.avg_response_ms == null ? null : Number(r.avg_response_ms),
    lastCheckedAt: toIso(r.last_checked_at),
    mirrors: Number(r.mirrors ?? 0),
    score: Number(r.score ?? 0),
  }));

  return {
    results,
    total: Number(countRows.rows[0]?.n ?? 0),
    tookMs: Date.now() - started,
  };
}

export interface EngineStats {
  pages: number;
  sites: number;
  online: number;
  offline: number;
  blocked: number;
  mirrors: number;
  queuePending: number;
  queueDone: number;
  queueFailed: number;
  checks24h: number;
  reportsOpen: number;
  lastCrawlAt: string | null;
}

export async function getStats(): Promise<EngineStats> {
  const r = await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM pages) AS pages,
      (SELECT count(*)::int FROM onion_sites) AS sites,
      (SELECT count(*)::int FROM onion_sites WHERE status='online' AND is_blocked=false AND canonical_id IS NULL) AS online,
      (SELECT count(*)::int FROM onion_sites WHERE status='offline' AND is_blocked=false) AS offline,
      (SELECT count(*)::int FROM onion_sites WHERE is_blocked=true) AS blocked,
      (SELECT count(*)::int FROM onion_sites WHERE canonical_id IS NOT NULL) AS mirrors,
      (SELECT count(*)::int FROM crawl_queue WHERE status='pending') AS queue_pending,
      (SELECT count(*)::int FROM crawl_queue WHERE status='done') AS queue_done,
      (SELECT count(*)::int FROM crawl_queue WHERE status IN ('failed','blocked')) AS queue_failed,
      (SELECT count(*)::int FROM health_checks WHERE checked_at > now() - interval '24 hours') AS checks_24h,
      (SELECT count(*)::int FROM reports WHERE status='open') AS reports_open,
      (SELECT max(crawled_at)::text FROM pages) AS last_crawl_at
  `);
  const row = r.rows[0] as Record<string, unknown>;
  const num = (k: string) => Number(row[k] ?? 0);
  return {
    pages: num("pages"),
    sites: num("sites"),
    online: num("online"),
    offline: num("offline"),
    blocked: num("blocked"),
    mirrors: num("mirrors"),
    queuePending: num("queue_pending"),
    queueDone: num("queue_done"),
    queueFailed: num("queue_failed"),
    checks24h: num("checks_24h"),
    reportsOpen: num("reports_open"),
    lastCrawlAt: row.last_crawl_at ? String(row.last_crawl_at) : null,
  };
}

export interface HourBucket {
  hour: string;
  online: number;
  offline: number;
}

/** Serie de verificaciones por hora (últimas 24h) para el gráfico del panel. */
export async function getChecksSeries(): Promise<HourBucket[]> {
  const r = await db.execute(sql`
    SELECT to_char(date_trunc('hour', checked_at), 'HH24:00') AS hour,
           count(*) FILTER (WHERE online)::int AS online,
           count(*) FILTER (WHERE NOT online)::int AS offline
    FROM health_checks
    WHERE checked_at > now() - interval '24 hours'
    GROUP BY 1 ORDER BY 1
  `);
  return (r.rows as Record<string, unknown>[]).map((x) => ({
    hour: String(x.hour),
    online: Number(x.online),
    offline: Number(x.offline),
  }));
}

export interface RecentSite {
  domain: string;
  title: string;
  status: string;
  uptimeRatio: number;
  lastCheckedAt: string | null;
}

export async function getRecentSites(limit = 8): Promise<RecentSite[]> {
  const r = await db.execute(sql`
    SELECT domain, coalesce(title, domain) AS title, status, uptime_ratio,
           last_checked_at::text AS last_checked_at
    FROM onion_sites
    WHERE is_blocked = false AND canonical_id IS NULL AND last_crawled_at IS NOT NULL
    ORDER BY last_crawled_at DESC
    LIMIT ${limit}
  `);
  return (r.rows as Record<string, unknown>[]).map((x) => ({
    domain: String(x.domain),
    title: String(x.title),
    status: String(x.status),
    uptimeRatio: Number(x.uptime_ratio ?? 0),
    lastCheckedAt: x.last_checked_at ? String(x.last_checked_at) : null,
  }));
}

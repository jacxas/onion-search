// FARO — búsqueda: PostgreSQL FTS primero (tsvector + websearch_to_tsquery),
// ranking = relevancia × uptime + boost si en línea − castigo si caído.
// Meilisearch queda como índice secundario opcional (ver README).

import { sql } from "drizzle-orm";
import { db } from "../db";
import type { Database } from "../db";

export interface SearchHit {
  id: number;
  url: string;
  title: string;
  description: string | null;
  domain: string;
  online: boolean;
  uptimeRatio: number;
  mirrorGroupId: number | null;
  relevance: number;
  score: number;
}

export interface SearchOptions {
  limit?: number;
  offset?: number;
  onlineOnly?: boolean;
  domain?: string;
}

export interface SearchStats {
  sites: number;
  online: number;
  blocked: number;
  pages: number;
  pendingQueue: number;
  mirrors: number;
  lastCrawlAt: Date | null;
}

const tsvectorExpr = sql`to_tsvector('simple', coalesce(p.title, '') || ' ' || coalesce(p.description, '') || ' ' || p.content)`;

/** Crea el índice GIN de FTS si no existe (idempotente). */
export async function ensureSearchIndexes(): Promise<void> {
  await db().execute(
    sql`CREATE INDEX IF NOT EXISTS pages_fts_idx ON pages USING gin (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || content))`
  );
}

/**
 * Búsqueda pública por FTS con ranking por salud.
 * score = ts_rank × (0.2 + 0.8 × uptime) × (en línea ? 1.25 : 0.6)
 */
export async function searchPages(query: string, opts: SearchOptions = {}): Promise<SearchHit[]> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  const q = query.trim().slice(0, 256);
  if (!q) return [];

  const relevance = sql`ts_rank(${tsvectorExpr}, websearch_to_tsquery('simple', ${q}))`;
  const score = sql`${relevance} * (0.2 + 0.8 * s.uptime_ratio) * (CASE WHEN s.online THEN 1.25 ELSE 0.6 END)`;

  const rows = await db().execute(sql`
    SELECT p.id, p.url, p.title, p.description, s.domain, s.online,
           s.uptime_ratio AS "uptimeRatio", s.mirror_group_id AS "mirrorGroupId",
           ${relevance} AS relevance, ${score} AS score
    FROM pages p
    JOIN sites s ON s.id = p.site_id
    WHERE ${tsvectorExpr} @@ websearch_to_tsquery('simple', ${q})
      AND s.blocked = false
      ${opts.onlineOnly ? sql`AND s.online = true` : sql``}
      ${opts.domain ? sql`AND s.domain = ${opts.domain}` : sql``}
    ORDER BY score DESC, p.crawled_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `);

  return (rows.rows as Record<string, unknown>[]).map((r) => ({
    id: Number(r.id),
    url: String(r.url),
    title: String(r.title ?? ""),
    description: r.description == null ? null : String(r.description),
    domain: String(r.domain),
    online: Boolean(r.online),
    uptimeRatio: Number(r.uptimeRatio),
    mirrorGroupId: r.mirrorGroupId == null ? null : Number(r.mirrorGroupId),
    relevance: Number(r.relevance),
    score: Number(r.score),
  }));
}

/** Estadísticas para el dashboard y /api/stats. */
export async function getStats(database?: Database): Promise<SearchStats> {
  const d = database ?? db();
  const res = await d.execute(sql`
    SELECT
      (SELECT count(*) FROM sites) AS sites,
      (SELECT count(*) FROM sites WHERE online) AS online,
      (SELECT count(*) FROM sites WHERE blocked) AS blocked,
      (SELECT count(*) FROM pages) AS pages,
      (SELECT count(*) FROM crawl_queue WHERE status = 'pending') AS "pendingQueue",
      (SELECT count(DISTINCT mirror_group_id) FROM sites WHERE mirror_group_id IS NOT NULL) AS mirrors,
      (SELECT max(last_crawled_at) FROM sites) AS "lastCrawlAt"
  `);
  const r = (res.rows[0] ?? {}) as Record<string, unknown>;
  return {
    sites: Number(r.sites ?? 0),
    online: Number(r.online ?? 0),
    blocked: Number(r.blocked ?? 0),
    pages: Number(r.pages ?? 0),
    pendingQueue: Number(r.pendingQueue ?? 0),
    mirrors: Number(r.mirrors ?? 0),
    lastCrawlAt: r.lastCrawlAt ? new Date(String(r.lastCrawlAt)) : null,
  };
}

/** Ficha de dominio para /sitio/[domain]: sitio + últimas páginas + salud. */
export async function getDomainDetail(domain: string) {
  const d = db();
  const siteRes = await d.execute(
    sql`SELECT id, domain, url, title, description, online, blocked, block_reason, status_code,
               uptime_ratio AS "uptimeRatio", avg_response_ms AS "avgResponseMs",
               total_checks AS "totalChecks", successful_checks AS "successfulChecks",
               last_online_at AS "lastOnlineAt", last_crawled_at AS "lastCrawledAt", discovered_at AS "discoveredAt"
        FROM sites WHERE domain = ${domain} LIMIT 1`
  );
  const site = siteRes.rows[0];
  if (!site) return null;

  const siteId = Number((site as Record<string, unknown>).id);
  const [pagesRes, healthRes, mirrorsRes] = await Promise.all([
    d.execute(
      sql`SELECT id, url, path, title, description, content_hash AS "contentHash", depth, crawled_at AS "crawledAt"
          FROM pages WHERE site_id = ${siteId} ORDER BY depth, crawled_at DESC LIMIT 50`
    ),
    d.execute(
      sql`SELECT status_code AS "statusCode", online, response_ms AS "responseMs", error, checked_at AS "checkedAt"
          FROM health_checks WHERE site_id = ${siteId} ORDER BY checked_at DESC LIMIT 100`
    ),
    d.execute(
      sql`SELECT domain, url, online, uptime_ratio AS "uptimeRatio"
          FROM sites WHERE mirror_group_id = (SELECT mirror_group_id FROM sites WHERE id = ${siteId})
          AND id <> ${siteId} AND mirror_group_id IS NOT NULL LIMIT 10`
    ),
  ]);
  return {
    site: site as Record<string, unknown>,
    pages: pagesRes.rows as Record<string, unknown>[],
    health: healthRes.rows as Record<string, unknown>[],
    mirrors: mirrorsRes.rows as Record<string, unknown>[],
  };
}

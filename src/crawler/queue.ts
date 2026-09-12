// FARO — cola de rastreo persistente (PostgreSQL). Migrado de crawler/spider.py
// (queue en memoria) para sobrevivir reinicios y ser observable desde /ops.

import { sql } from "drizzle-orm";
import { db } from "../db";
import { normalizeOnionUrl } from "../lib/onion";

export interface QueueItemRow {
  id: number;
  url: string;
  domain: string;
  depth: number;
  priority: number;
  attempts: number;
}

/** Encola URLs (semilla o descubierta). Ignora duplicados. Devuelve las nuevas. */
export async function enqueue(urls: string[], depth: number, priority: number): Promise<number> {
  const rows: { url: string; domain: string; depth: number; priority: number }[] = [];
  for (const raw of urls) {
    const n = normalizeOnionUrl(raw);
    if (!n.ok) continue;
    rows.push({ url: n.url, domain: n.domain, depth, priority });
  }
  if (!rows.length) return 0;
  const res = await db().execute(sql`
    INSERT INTO crawl_queue (url, domain, depth, priority)
    SELECT * FROM unnest(
      ${rows.map((r) => r.url)}::text[],
      ${rows.map((r) => r.domain)}::varchar(64)[],
      ${rows.map((r) => r.depth)}::int[],
      ${rows.map((r) => r.priority)}::int[]
    )
    ON CONFLICT (url) DO NOTHING
  `);
  // node-postgres: rowCount de INSERT ... SELECT
  return (res as unknown as { rowCount?: number }).rowCount ?? rows.length;
}

/** Marca semillas en sites (is_seed) y las encola con prioridad máxima. */
export async function seedQueue(seedUrls: string[]): Promise<number> {
  const n = await enqueue(seedUrls, 0, 10);
  const normalized = seedUrls
    .map((u) => normalizeOnionUrl(u))
    .filter((r): r is Extract<typeof r, { ok: true }> => r.ok);
  for (const s of normalized) {
    await db().execute(sql`
      INSERT INTO sites (domain, url, is_seed)
      VALUES (${s.domain}, ${s.url}, true)
      ON CONFLICT (domain) DO UPDATE SET is_seed = true
    `);
  }
  return n;
}

/** Toma un lote de URLs pendientes (orden: prioridad, antigüedad). */
export async function takeBatch(limit: number): Promise<QueueItemRow[]> {
  const res = await db().execute(sql`
    SELECT id, url, domain, depth, priority, attempts
    FROM crawl_queue
    WHERE status = 'pending'
    ORDER BY priority DESC, discovered_at ASC
    LIMIT ${limit}
  `);
  return (res.rows as Record<string, unknown>[]).map((r) => ({
    id: Number(r.id),
    url: String(r.url),
    domain: String(r.domain),
    depth: Number(r.depth),
    priority: Number(r.priority),
    attempts: Number(r.attempts),
  }));
}

export async function markDone(id: number): Promise<void> {
  await db().execute(
    sql`UPDATE crawl_queue SET status = 'done', processed_at = now() WHERE id = ${id}`
  );
}

export async function markFailed(id: number, error: string, attempts: number, maxAttempts: number): Promise<void> {
  const retry = attempts < maxAttempts;
  await db().execute(sql`
    UPDATE crawl_queue
    SET status = ${retry ? "pending" : "failed"},
        attempts = ${attempts},
        last_error = ${error.slice(0, 500)},
        processed_at = now()
    WHERE id = ${id}
  `);
}

export async function markBlocked(id: number, reason: string): Promise<void> {
  await db().execute(
    sql`UPDATE crawl_queue SET status = 'blocked', last_error = ${reason}, processed_at = now() WHERE id = ${id}`
  );
}

export async function countPending(): Promise<number> {
  const res = await db().execute(sql`SELECT count(*)::int AS n FROM crawl_queue WHERE status = 'pending'`);
  return Number((res.rows[0] as Record<string, unknown>).n ?? 0);
}

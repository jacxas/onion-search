// FARO — health checker: uptime con historial (últimos 100 checks),
// EWMA de latencia y timeout adaptativo. Migrado de health_checker/checker.py.

import { sql } from "drizzle-orm";
import { db } from "../db";
import { getConfig } from "../lib/config";
import type { OnionTransport } from "../lib/tor/transport";

export interface HealthCheckResult {
  domain: string;
  online: boolean;
  statusCode: number;
  responseMs: number | null;
  error: string | null;
  wasOnline: boolean; // estado previo (para alertas de transición)
}

export interface SweepSummary {
  checked: number;
  up: number;
  down: number;
  transitions: { domain: string; from: boolean; to: boolean }[];
}

/** Timeout adaptativo: EWMA×3 acotado entre 5s y health.timeoutMs. */
function adaptiveTimeout(avgResponseMs: number | null, baseMs: number): number {
  if (!avgResponseMs) return baseMs;
  return Math.min(Math.max(avgResponseMs * 3, 5_000), baseMs);
}

/** Un check individual sobre la landing del sitio. */
export async function checkSite(
  transport: OnionTransport,
  site: { id: number; domain: string; url: string; avgResponseMs: number | null }
): Promise<HealthCheckResult> {
  const cfg = getConfig();
  const timeoutMs = adaptiveTimeout(site.avgResponseMs, cfg.health.timeoutMs);
  const res = await transport.fetch(site.url, { timeoutMs });
  const online = res.ok && res.status > 0 && res.status < 400;
  return {
    domain: site.domain,
    online,
    statusCode: res.status,
    responseMs: online ? res.elapsedMs : null,
    error: online ? null : res.error ?? `http_${res.status}`,
    wasOnline: false, // lo completa el llamador (sweep conoce el estado previo)
  };
}

/** Persiste un check: historial + stats del sitio (EWMA 0.3/0.7 como legacy). */
export async function recordCheck(
  siteId: number,
  result: HealthCheckResult,
  wasOnline: boolean
): Promise<void> {
  const d = db();
  await d.execute(sql`
    INSERT INTO health_checks (site_id, status_code, online, response_ms, error)
    VALUES (${siteId}, ${result.statusCode}, ${result.online}, ${result.responseMs}, ${result.error})
  `);
  await d.execute(sql`
    UPDATE sites SET
      online = ${result.online},
      status_code = ${result.statusCode},
      last_response_ms = ${result.responseMs},
      avg_response_ms = CASE
        WHEN ${result.online} AND ${result.responseMs} IS NOT NULL AND avg_response_ms IS NULL
          THEN ${result.responseMs}
        WHEN ${result.online} AND ${result.responseMs} IS NOT NULL
          THEN round(0.3 * ${result.responseMs} + 0.7 * avg_response_ms)::int
        ELSE avg_response_ms
      END,
      total_checks = total_checks + 1,
      successful_checks = successful_checks + ${result.online ? 1 : 0},
      uptime_ratio = (successful_checks::float + ${result.online ? 1 : 0}) / (total_checks + 1),
      last_checked_at = now(),
      last_online_at = CASE WHEN ${result.online} THEN now() ELSE last_online_at END
    WHERE id = ${siteId}
  `);
  // mantener solo los últimos 100 checks por sitio
  await d.execute(sql`
    DELETE FROM health_checks WHERE site_id = ${siteId} AND id NOT IN (
      SELECT id FROM health_checks WHERE site_id = ${siteId} ORDER BY checked_at DESC LIMIT 100
    )
  `);
  void wasOnline;
}

/**
 * Barrido de salud: verifica sitios vencidos (intervalMin) o nunca chequeados.
 * Devuelve transiciones para alertas de email.
 */
export async function healthSweep(
  transport: OnionTransport,
  opts: { limit?: number; force?: boolean } = {}
): Promise<SweepSummary> {
  const cfg = getConfig();
  const limit = Math.min(Math.max(opts.limit ?? 40, 1), 200);
  const res = await db().execute(sql`
    SELECT id, domain, url, avg_response_ms AS "avgResponseMs", online
    FROM sites
    WHERE blocked = false AND (
      ${opts.force ?? false}
      OR last_checked_at IS NULL
      OR last_checked_at < now() - (${cfg.health.intervalMin} || ' minutes')::interval
    )
    ORDER BY last_checked_at ASC NULLS FIRST
    LIMIT ${limit}
  `);

  const summary: SweepSummary = { checked: 0, up: 0, down: 0, transitions: [] };
  for (const raw of res.rows as Record<string, unknown>[]) {
    const site = {
      id: Number(raw.id),
      domain: String(raw.domain),
      url: String(raw.url),
      avgResponseMs: raw.avgResponseMs == null ? null : Number(raw.avgResponseMs),
    };
    const wasOnline = Boolean(raw.online);
    const result = await checkSite(transport, site);
    result.wasOnline = wasOnline;
    await recordCheck(site.id, result, wasOnline);
    summary.checked++;
    if (result.online) summary.up++;
    else summary.down++;
    if (result.online !== wasOnline) {
      summary.transitions.push({ domain: result.domain, from: wasOnline, to: result.online });
    }
  }
  return summary;
}

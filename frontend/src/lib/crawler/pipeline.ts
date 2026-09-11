import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  blocklist,
  crawlEvents,
  crawlQueue,
  healthChecks,
  onionSites,
  pages,
} from "@/db/schema";
import { normalizeOnionUrl, clamp } from "@/lib/onion";
import { parsePage } from "@/lib/crawler/parse";
import { CRAWL_MODE, torFetch } from "@/lib/tor/transport";
import { SIM_HUB_SEEDS } from "@/lib/tor/sim";
import { sendThrottledAlert } from "@/lib/mail";

const CRAWL_MAX_DEPTH = Number(process.env.CRAWL_MAX_DEPTH ?? 2);
const CRAWL_DOMAIN_CAP = Number(process.env.CRAWL_DOMAIN_CAP ?? 12);
const CRAWL_TIMEOUT_MS = Number(process.env.CRAWL_TIMEOUT_MS ?? 30000);
const HEALTH_TIMEOUT_MS = Number(process.env.HEALTH_TIMEOUT_MS ?? 20000);
const MAX_ATTEMPTS = 4;
const HEALTH_INTERVAL_MIN = Number(process.env.HEALTH_INTERVAL_MIN ?? 45);

const DEFAULT_BLOCK_KEYWORDS: Array<[string, string]> = [
  ["child porn", "CSAM"],
  ["csam", "CSAM"],
  ["pedoporn", "CSAM"],
  ["preteen hardcore", "CSAM"],
];

// ───────────────────────────── utilidades ─────────────────────────────

export async function recordEvent(
  type: string,
  message: string,
  siteId?: number,
) {
  await db.insert(crawlEvents).values({ type, message, siteId });
}

async function isDomainBlocked(domain: string): Promise<string | null> {
  const rows = await db
    .select({ reason: blocklist.reason, value: blocklist.value })
    .from(blocklist)
    .where(sql`${blocklist.type} = 'domain' AND ${domain} LIKE '%' || ${blocklist.value}`)
    .limit(1);
  return rows.length ? rows[0].reason ?? `dominio bloqueado (${rows[0].value})` : null;
}

async function isContentBlocked(hash: string, haystack: string): Promise<string | null> {
  const hashHit = await db
    .select({ reason: blocklist.reason })
    .from(blocklist)
    .where(sql`${blocklist.type} = 'hash' AND ${blocklist.value} = ${hash}`)
    .limit(1);
  if (hashHit.length) return hashHit[0].reason ?? "hash en blocklist";

  const lower = haystack.toLowerCase();
  const kws = await db
    .select({ value: blocklist.value, reason: blocklist.reason })
    .from(blocklist)
    .where(sql`${blocklist.type} = 'keyword'`);
  for (const k of kws) {
    if (lower.includes(k.value.toLowerCase())) {
      return k.reason ?? `keyword bloqueada: ${k.value}`;
    }
  }
  return null;
}

export async function enqueueUrl(
  raw: string,
  opts: { priority?: number; depth?: number; isSeed?: boolean } = {},
): Promise<{ ok: boolean; error?: string }> {
  const n = normalizeOnionUrl(raw);
  if (!n) return { ok: false, error: "La URL no es un servicio .onion válido (v2/v3)" };

  const blocked = await isDomainBlocked(n.domain);
  if (blocked) return { ok: false, error: `Dominio en blocklist: ${blocked}` };

  if (opts.isSeed) {
    const existing = await db
      .select({ id: onionSites.id })
      .from(onionSites)
      .where(eq(onionSites.domain, n.domain))
      .limit(1);
    if (existing.length === 0) {
      await db
        .insert(onionSites)
        .values({ url: n.base, domain: n.domain, isSeed: true, status: "unknown" })
        .onConflictDoNothing();
    }
  }

  await db
    .insert(crawlQueue)
    .values({
      url: n.url,
      domain: n.domain,
      priority: opts.priority ?? 0,
      depth: opts.depth ?? 0,
    })
    .onConflictDoNothing();
  return { ok: true };
}

/** Siembra inicial: blocklist ética por defecto + hubs semilla. */
export async function ensureSeeded(): Promise<boolean> {
  const kwCount = await db.execute(
    sql`SELECT count(*)::int AS n FROM blocklist WHERE type = 'keyword'`,
  );
  const hasKw = Number(kwCount.rows[0]?.n ?? 0) > 0;
  if (!hasKw) {
    for (const [value, reason] of DEFAULT_BLOCK_KEYWORDS) {
      await db
        .insert(blocklist)
        .values({ type: "keyword", value, reason, source: "default" })
        .onConflictDoNothing();
    }
  }

  const qCount = await db.execute(
    sql`SELECT count(*)::int AS n FROM crawl_queue WHERE status IN ('pending','running')`,
  );
  const sCount = await db.execute(sql`SELECT count(*)::int AS n FROM onion_sites`);
  const hasWork = Number(qCount.rows[0]?.n ?? 0) > 0 || Number(sCount.rows[0]?.n ?? 0) > 0;

  if (hasWork) return false;

  if (CRAWL_MODE === "sim") {
    for (const domain of SIM_HUB_SEEDS) {
      await enqueueUrl(`http://${domain}/`, { priority: 10, isSeed: true });
    }
    await recordEvent("seed", `Semillas iniciales cargadas (${SIM_HUB_SEEDS.length} hubs descubiertos)`);
  } else {
    // En modo live el operador agrega sus propias semillas desde /ops
    const liveSeeds = (process.env.TOR_SEED_URLS ?? "")
      .split(/[\s,]+/)
      .filter(Boolean);
    for (const s of liveSeeds) {
      await enqueueUrl(s, { priority: 10, isSeed: true });
    }
    if (liveSeeds.length) {
      await recordEvent("seed", `Semillas cargadas desde TOR_SEED_URLS (${liveSeeds.length})`);
    }
  }
  return true;
}

// ────────────────────────── sitios & páginas ──────────────────────────

async function upsertPage(input: {
  siteId: number;
  url: string;
  title: string;
  description: string;
  text: string;
  hash: string;
  httpStatus: number;
  depth: number;
}) {
  await db
    .insert(pages)
    .values({
      siteId: input.siteId,
      url: input.url,
      title: input.title,
      description: input.description,
      contentText: input.text,
      contentHash: input.hash,
      httpStatus: input.httpStatus,
      depth: input.depth,
      crawledAt: new Date(),
    })
    .onConflictDoUpdate({
      target: pages.url,
      set: {
        title: input.title,
        description: input.description,
        contentText: input.text,
        contentHash: input.hash,
        httpStatus: input.httpStatus,
        crawledAt: new Date(),
      },
    });
}

async function findCanonicalByHash(hash: string, excludeDomain: string): Promise<number | null> {
  // 1) match contra el hash de CUALQUIER página de otro sitio (más robusto)
  const byPage = await db.execute(sql`
    SELECT p.site_id AS id FROM pages p
    JOIN onion_sites s ON s.id = p.site_id
    WHERE p.content_hash = ${hash}
      AND s.domain <> ${excludeDomain}
      AND s.canonical_id IS NULL
      AND s.is_blocked = false
    LIMIT 1
  `);
  if (byPage.rows.length) return Number((byPage.rows[0] as { id: number }).id);

  // 2) fallback: hash de home de otro sitio
  const rows = await db
    .select({ id: onionSites.id })
    .from(onionSites)
    .where(
      sql`${onionSites.contentHash} = ${hash}
          AND ${onionSites.domain} <> ${excludeDomain}
          AND ${onionSites.canonicalId} IS NULL
          AND ${onionSites.isBlocked} = false`,
    )
    .limit(1);
  return rows.length ? rows[0].id : null;
}

async function refreshSiteAggregates(siteId: number) {
  const agg = await db.execute(sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE online)::int AS ok,
           round(avg(response_ms) FILTER (WHERE online))::int AS avg_ms
    FROM (
      SELECT online, response_ms FROM health_checks
      WHERE site_id = ${siteId}
      ORDER BY checked_at DESC
      LIMIT 100
    ) t
  `);
  const row = agg.rows[0] as { total: number; ok: number; avg_ms: number | null };
  const uptime = row.total > 0 ? row.ok / row.total : 0;
  await db
    .update(onionSites)
    .set({
      checksTotal: row.total,
      checksOk: row.ok,
      uptimeRatio: Math.round(uptime * 1000) / 1000,
      avgResponseMs: row.avg_ms,
    })
    .where(eq(onionSites.id, siteId));
}

async function recordHealth(siteId: number, online: boolean, ms: number | null, httpStatus: number | null, error?: string) {
  // estado previo para detectar TRANSICIONES (no cada check, solo cambios)
  const prev = await db
    .select({
      status: onionSites.status,
      domain: onionSites.domain,
      uptimeRatio: onionSites.uptimeRatio,
    })
    .from(onionSites)
    .where(eq(onionSites.id, siteId))
    .limit(1);

  await db.insert(healthChecks).values({
    siteId,
    online,
    httpStatus,
    responseMs: ms,
    error: error?.slice(0, 300),
  });
  await db
    .update(onionSites)
    .set({
      status: online ? "online" : "offline",
      lastCheckedAt: new Date(),
      ...(online ? { lastOnlineAt: new Date() } : {}),
    })
    .where(eq(onionSites.id, siteId));
  await refreshSiteAggregates(siteId);

  // alertas por email: solo sitios que eran estables (evita spam de flaky hosts)
  const p = prev[0];
  if (!p) return;
  if (p.status === "online" && !online && p.uptimeRatio > 0.4) {
    void sendThrottledAlert(`down:${p.domain}`, 120, {
      subject: `servicio caído: ${p.domain.slice(0, 24)}…`,
      text: `El servicio ${p.domain} dejó de responder.\nUptime histórico: ${Math.round(p.uptimeRatio * 100)}%.\nError: ${error ?? "sin respuesta"}.\n\nSe reintentará automáticamente en el próximo sweep.`,
    });
  } else if (p.status === "offline" && online) {
    void sendThrottledAlert(`up:${p.domain}`, 120, {
      subject: `servicio recuperado: ${p.domain.slice(0, 24)}…`,
      text: `El servicio ${p.domain} volvió a estar en línea (${ms != null ? `${ms}ms` : "OK"}).`,
    });
  }
}

// ─────────────────────────── crawler batch ────────────────────────────

export interface BatchSummary {
  processed: number;
  ok: number;
  failed: number;
  blocked: number;
  discovered: number;
  pagesIndexed: number;
}

export async function runCrawlBatch(limit = 12): Promise<BatchSummary> {
  const items = await db
    .select()
    .from(crawlQueue)
    .where(and(eq(crawlQueue.status, "pending"), sql`${crawlQueue.nextRunAt} <= now()`))
    .orderBy(desc(crawlQueue.priority), asc(crawlQueue.id))
    .limit(limit);

  const summary: BatchSummary = { processed: 0, ok: 0, failed: 0, blocked: 0, discovered: 0, pagesIndexed: 0 };

  for (const item of items) {
    summary.processed++;
    await db.update(crawlQueue).set({ status: "running" }).where(eq(crawlQueue.id, item.id));

    const domainBlock = await isDomainBlocked(item.domain);
    if (domainBlock) {
      await db.update(crawlQueue).set({ status: "blocked", lastError: domainBlock }).where(eq(crawlQueue.id, item.id));
      await recordEvent("block", `${item.domain} omitido: ${domainBlock}`);
      summary.blocked++;
      continue;
    }

    const timeout = item.attempts > 0 ? Math.min(CRAWL_TIMEOUT_MS, 15000) : CRAWL_TIMEOUT_MS;
    const res = await torFetch(item.url, timeout);

    if (!res.ok || !res.html) {
      const attempts = item.attempts + 1;
      const backoffMin = Math.min(60, 5 * attempts);
      const done = attempts >= MAX_ATTEMPTS;
      await db
        .update(crawlQueue)
        .set({
          status: done ? "failed" : "pending",
          attempts,
          lastError: res.error ?? `HTTP ${res.httpStatus}`,
          nextRunAt: new Date(Date.now() + backoffMin * 60_000),
        })
        .where(eq(crawlQueue.id, item.id));

      const site = await db.select({ id: onionSites.id }).from(onionSites).where(eq(onionSites.domain, item.domain)).limit(1);
      if (site.length) {
        await recordHealth(site[0].id, false, res.responseMs, res.httpStatus || null, res.error);
      }
      await recordEvent("crawl", `FALLO ${item.domain} → ${res.error ?? `HTTP ${res.httpStatus}`} (intento ${attempts}/${MAX_ATTEMPTS})`);
      summary.failed++;
      continue;
    }

    // parse + bloqueo por contenido
    const parsed = parsePage(res.html, item.url);
    const contentBlock = await isContentBlocked(parsed.hash, `${parsed.title} ${parsed.text}`);
    if (contentBlock) {
      await db.update(crawlQueue).set({ status: "blocked", lastError: contentBlock }).where(eq(crawlQueue.id, item.id));
      await db.execute(sql`
        UPDATE onion_sites SET is_blocked = true, blocked_reason = ${contentBlock}
        WHERE domain = ${item.domain}
      `);
      await recordEvent("block", `${item.domain} BLOQUEADO: ${contentBlock}`);
      void sendThrottledAlert(`block:${item.domain}`, 24 * 60, {
        subject: `sitio bloqueado por blocklist`,
        text: `El crawler bloqueó ${item.domain}.\nMotivo: ${contentBlock}.\nQuedó excluido del índice de búsqueda.`,
      });
      summary.blocked++;
      continue;
    }

    // upsert del sitio + detección de mirrors por fingerprint
    // (el hash del sitio solo se fija desde la home: las subpáginas no deben
    // pisarlo, o la comparación de espejos pierde estabilidad)
    const isHome = item.url === `http://${item.domain}/`;
    let siteId: number;
    const existing = await db.select().from(onionSites).where(eq(onionSites.domain, item.domain)).limit(1);
    const canonicalOf = await findCanonicalByHash(parsed.hash, item.domain);
    if (existing.length) {
      siteId = existing[0].id;
      await db
        .update(onionSites)
        .set({
          ...(isHome
            ? {
                title: parsed.title.slice(0, 200),
                description: parsed.description,
                contentHash: parsed.hash,
              }
            : {}),
          canonicalId: existing[0].canonicalId ?? canonicalOf ?? null,
          lastCrawledAt: new Date(),
        })
        .where(eq(onionSites.id, siteId));
    } else {
      const inserted = await db
        .insert(onionSites)
        .values({
          url: `http://${item.domain}`,
          domain: item.domain,
          title: parsed.title.slice(0, 200),
          description: parsed.description,
          contentHash: parsed.hash,
          canonicalId: canonicalOf,
          lastCrawledAt: new Date(),
        })
        .onConflictDoNothing()
        .returning();
      siteId = (inserted[0] as { id: number } | undefined)?.id ?? (await db.select({ id: onionSites.id }).from(onionSites).where(eq(onionSites.domain, item.domain)).limit(1))[0].id;
    }

    // Dirección canónica estable: el sitio MÁS ANTIGUO (menor id) queda como
    // canónico; el más joven se marca como espejo. Sin esto, el orden de la
    // cola decide (mal) cuál es el "original".
    if (canonicalOf != null && canonicalOf !== siteId) {
      if (canonicalOf < siteId) {
        // ya asignado arriba: este sitio es el espejo
      } else {
        // el sitio matcheado es más joven → re-apuntarlo (y sus espejos) a éste
        await db
          .update(onionSites)
          .set({ canonicalId: siteId })
          .where(sql`${onionSites.id} = ${canonicalOf} OR ${onionSites.canonicalId} = ${canonicalOf}`);
        await db
          .update(onionSites)
          .set({ canonicalId: null })
          .where(eq(onionSites.id, siteId));
        await recordEvent("discover", `Re-canonicalización: ahora #${siteId} es el canónico (antes #${canonicalOf})`, siteId);
      }
      await recordEvent("discover", `Espejo detectado: ${item.domain} → fingerprint duplicado`, siteId);
    }

    await upsertPage({
      siteId,
      url: item.url,
      title: parsed.title,
      description: parsed.description,
      text: parsed.text,
      hash: parsed.hash,
      httpStatus: res.httpStatus,
      depth: item.depth,
    });
    summary.pagesIndexed++;

    await recordHealth(siteId, true, res.responseMs, res.httpStatus);

    // descubrimiento de enlaces con límites de profundidad y por dominio
    let newLinks = 0;
    if (item.depth < CRAWL_MAX_DEPTH) {
      const domainPageCount = await db.execute(sql`
        SELECT count(*)::int AS n FROM pages WHERE site_id = ${siteId}
      `);
      const capReached = Number(domainPageCount.rows[0]?.n ?? 0) >= CRAWL_DOMAIN_CAP;

      for (const link of parsed.links) {
        if (capReached && link.includes(item.domain)) continue;
        const n = normalizeOnionUrl(link);
        if (!n) continue;
        const r = await db
          .insert(crawlQueue)
          .values({ url: n.url, domain: n.domain, priority: Math.max(1, 5 - item.depth), depth: item.depth + 1 })
          .onConflictDoNothing()
          .returning();
        if (r.length) newLinks++;
      }
    }
    summary.discovered += newLinks;
    summary.ok++;

    await db.update(crawlQueue).set({ status: "done" }).where(eq(crawlQueue.id, item.id));
    await recordEvent(
      "crawl",
      `OK ${item.domain} · ${res.responseMs}ms · +${newLinks} enlaces · "${parsed.title.slice(0, 60)}"`,
      siteId,
    );
  }

  if (summary.processed > 0) {
    await recordEvent(
      "system",
      `Lote de rastreo: ${summary.ok} OK, ${summary.failed} fallos, ${summary.blocked} bloqueados, ${summary.discovered} enlaces nuevos (modo ${CRAWL_MODE})`,
    );
  }
  return summary;
}

// ─────────────────── health checker (verificación activa) ───────────────────

export interface SweepSummary {
  checked: number;
  online: number;
  offline: number;
  avgMs: number;
}

export async function runHealthSweep(limit = 20): Promise<SweepSummary> {
  const due = await db
    .select({ id: onionSites.id, domain: onionSites.domain, url: onionSites.url, uptimeRatio: onionSites.uptimeRatio })
    .from(onionSites)
    .where(
      and(
        eq(onionSites.isBlocked, false),
        sql`(${onionSites.lastCheckedAt} IS NULL OR ${onionSites.lastCheckedAt} < now() - interval '${sql.raw(String(HEALTH_INTERVAL_MIN))} minutes')`,
      ),
    )
    .orderBy(sql`${onionSites.lastCheckedAt} ASC NULLS FIRST`)
    .limit(limit);

  const out: SweepSummary = { checked: 0, online: 0, offline: 0, avgMs: 0 };
  let msTotal = 0;

  for (const site of due) {
    // timeout adaptativo: sitios estables piden respuesta más rápido
    const timeout = site.uptimeRatio > 0.7 ? 15000 : HEALTH_TIMEOUT_MS;
    const res = await torFetch(site.url, clamp(timeout, 5000, 60000));
    await recordHealth(site.id, res.ok, res.responseMs, res.httpStatus || null, res.error);
    out.checked++;
    if (res.ok) {
      out.online++;
      msTotal += res.responseMs;
    } else {
      out.offline++;
      await recordEvent("health", `${site.domain} offline (${res.error ?? "sin respuesta"})`, site.id);
    }
  }
  out.avgMs = out.online > 0 ? Math.round(msTotal / out.online) : 0;

  if (out.checked > 0) {
    await recordEvent("system", `Health sweep: ${out.online}/${out.checked} en línea · avg ${out.avgMs}ms`);
  }
  return out;
}

/** Pipeline completo: un lote de rastreo + un sweep de salud. */
export async function runPipelineOnce(crawlLimit = 12, healthLimit = 20) {
  await ensureSeeded();
  const crawl = await runCrawlBatch(crawlLimit);
  const health = await runHealthSweep(healthLimit);
  return { crawl, health };
}

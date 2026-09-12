// FARO — orquestación del pipeline: seed → crawl (fetch+parse) → dedupe/mirrors
// → persist. Migrado de crawler/spider.py con cola en PostgreSQL.

import { sql } from "drizzle-orm";
import { db } from "../db";
import { getConfig } from "../lib/config";
import { contentFingerprint } from "../lib/onion";
import { getTransport } from "../lib/tor/transport";
import { assignMirrorGroup, blockSite, checkBlocklist } from "./dedupe";
import { fetchWithRetry } from "./fetch";
import { countPending, enqueue, markBlocked, markDone, markFailed, seedQueue, takeBatch } from "./queue";

export interface PipelineOptions {
  maxPages?: number;
  batchSize?: number;
  maxRetries?: number;
}

export interface PipelineSummary {
  mode: string;
  attempted: number;
  crawled: number;
  failed: number;
  blocked: number;
  discovered: number;
  elapsedMs: number;
  pending: number;
}

/** Upsert de sitio por dominio (title/description/estado del último crawl). */
async function upsertSite(domain: string, url: string, title: string, description: string | null, status: number, hash: string): Promise<number> {
  const res = await db().execute(sql`
    INSERT INTO sites (domain, url, title, description, status_code, content_hash, last_crawled_at)
    VALUES (${domain}, ${url}, ${title.slice(0, 300)}, ${description}, ${status}, ${hash}, now())
    ON CONFLICT (domain) DO UPDATE SET
      url = EXCLUDED.url, title = EXCLUDED.title, description = EXCLUDED.description,
      status_code = EXCLUDED.status_code, content_hash = EXCLUDED.content_hash,
      last_crawled_at = now()
    RETURNING id
  `);
  return Number((res.rows[0] as Record<string, unknown>).id);
}

async function upsertPage(
  siteId: number,
  url: string,
  path: string,
  title: string,
  description: string | null,
  content: string,
  hash: string,
  depth: number,
  linksFound: number
): Promise<void> {
  await db().execute(sql`
    INSERT INTO pages (site_id, url, path, title, description, content, content_hash, depth, links_found)
    VALUES (${siteId}, ${url}, ${path}, ${title.slice(0, 300)}, ${description}, ${content.slice(0, 12_000)}, ${hash}, ${depth}, ${linksFound})
    ON CONFLICT (url) DO UPDATE SET
      title = EXCLUDED.title, description = EXCLUDED.description, content = EXCLUDED.content,
      content_hash = EXCLUDED.content_hash, depth = EXCLUDED.depth,
      links_found = EXCLUDED.links_found, crawled_at = now()
  `);
}

/**
 * Ejecuta un lote de rastreo. Semillas: TOR_SEED_URLS (live) o los hubs del
 * SimTransport (sim). Descubre enlaces hasta maxDepth; cap por dominio.
 */
export async function runPipeline(opts: PipelineOptions = {}): Promise<PipelineSummary> {
  const cfg = getConfig();
  const transport = getTransport();
  const maxPages = Math.min(opts.maxPages ?? 60, 500);
  const batchSize = Math.min(opts.batchSize ?? 12, 50);
  const maxRetries = opts.maxRetries ?? 1;
  const maxDepth = cfg.crawl.maxDepth;
  const domainCap = cfg.crawl.domainCap;

  // semillas si la cola está vacía
  if ((await countPending()) === 0) {
    let seeds: string[] = cfg.torSeedUrls;
    if (!seeds.length && transport.mode === "sim" && "seedDomains" in transport) {
      seeds = (transport as unknown as { seedDomains(): string[] }).seedDomains();
    }
    if (seeds.length) await seedQueue(seeds);
  }

  const summary: PipelineSummary = {
    mode: transport.name, attempted: 0, crawled: 0, failed: 0, blocked: 0,
    discovered: 0, elapsedMs: 0, pending: 0,
  };
  const started = Date.now();
  const domainsThisRun = new Map<string, number>(); // cap por dominio

  while (summary.attempted < maxPages) {
    const batch = await takeBatch(Math.min(batchSize, maxPages - summary.attempted));
    if (!batch.length) break;

    for (const item of batch) {
      summary.attempted++;
      if (item.depth > maxDepth) {
        await markDone(item.id);
        continue;
      }
      const capped = (domainsThisRun.get(item.domain) ?? 0) >= domainCap;
      if (capped) {
        await markFailed(item.id, "domain_cap", item.attempts + 1, 1); // no reintenta: cap del run
        continue;
      }

      const result = await fetchWithRetry(transport, item.url, maxRetries);
      if (!result.parsed) {
        await markFailed(item.id, result.error ?? "unknown", item.attempts + 1, maxRetries + 1);
        summary.failed++;
        continue;
      }

      const page = result.parsed;
      const hash = contentFingerprint(page.text || page.title || item.url);
      const bl = await checkBlocklist(item.url, null);
      if (bl.blocked) {
        await markBlocked(item.id, bl.reason ?? "blocklist");
        await blockSite(item.domain, bl.reason ?? "blocklist");
        summary.blocked++;
        continue;
      }

      const path = (() => {
        try {
          const u = new URL(item.url);
          return `${u.pathname}${u.search}` || "/";
        } catch {
          return "/";
        }
      })();

      const siteId = await upsertSite(item.domain, item.url, page.title || item.domain, page.description, result.status, hash);
      await upsertPage(siteId, item.url, path, page.title || item.domain, page.description, page.text, hash, item.depth, page.links.length);
      await assignMirrorGroup(siteId, hash);

      // descubrimiento (solo dentro del límite de profundidad);
      // la cola deduplica por ON CONFLICT (url)
      if (item.depth < maxDepth && page.links.length) {
        summary.discovered += await enqueue(page.links, item.depth + 1, 0);
      }

      await markDone(item.id);
      domainsThisRun.set(item.domain, (domainsThisRun.get(item.domain) ?? 0) + 1);
      summary.crawled++;
    }
  }

  summary.pending = await countPending();
  summary.elapsedMs = Date.now() - started;
  return summary;
}

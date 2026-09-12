// FARO — deduplicación y mirror grouping por fingerprint SHA-256 del
// contenido normalizado. Migrado de crawler/spider.py + db/models.py.

import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { sites } from "../db/schema";
import { contentFingerprint, onionDomainOf } from "../lib/onion";

export interface BlocklistMatch {
  blocked: boolean;
  reason: string | null;
}

/** Verifica blocklist por patrón (dominio o URL exacta) y por hash. */
export async function checkBlocklist(url: string, contentHash: string | null): Promise<BlocklistMatch> {
  const domain = onionDomainOf(url);
  const res = await db().execute(sql`
    SELECT reason FROM blocklist
    WHERE pattern = ${url} OR pattern = ${domain} OR (content_hash IS NOT NULL AND content_hash = ${contentHash})
    LIMIT 1
  `);
  const row = res.rows[0] as Record<string, unknown> | undefined;
  return row ? { blocked: true, reason: String(row.reason) } : { blocked: false, reason: null };
}

/** Aplica bloqueo a un sitio por dominio. */
export async function blockSite(domain: string, reason: string): Promise<void> {
  await db().execute(sql`
    UPDATE sites SET blocked = true, block_reason = ${reason.slice(0, 250)} WHERE domain = ${domain}
  `);
}

/**
 * Asigna el grupo de espejos: sitios con el mismo fingerprint comparten
 * mirror_group_id (el id menor del grupo). Idempotente.
 */
export async function assignMirrorGroup(siteId: number, contentHash: string | null): Promise<number | null> {
  if (!contentHash) return null;
  const twins = await db()
    .select({ id: sites.id, groupId: sites.mirrorGroupId })
    .from(sites)
    .where(and(eq(sites.contentHash, contentHash), ne(sites.id, siteId)))
    .limit(1);

  let groupId: number;
  if (twins.length > 0) {
    const twin = twins[0];
    groupId = twin.groupId ?? Math.min(twin.id, siteId);
    if (!twin.groupId) {
      await db().update(sites).set({ mirrorGroupId: groupId }).where(eq(sites.id, twin.id));
    }
  } else {
    groupId = siteId;
  }
  await db().update(sites).set({ mirrorGroupId: groupId }).where(eq(sites.id, siteId));
  return groupId;
}

/** Fingerprint del contenido de una página (re-export de utilidades). */
export function pageFingerprint(text: string): string {
  return contentFingerprint(text);
}

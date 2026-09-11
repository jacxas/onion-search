import { createHash } from "crypto";

export const ONION_DOMAIN_RE = /^(?:[a-z2-7]{16}|[a-z2-7]{56})\.onion$/i;
const B32 = "abcdefghijklmnopqrstuvwxyz234567";

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** v3 onion address determinista derivado de una semilla. */
export function onionAddressFromSeed(seed: string): string {
  const h = sha256Hex(`onion:${seed}`);
  let out = "";
  for (let i = 0; i < 56; i++) {
    out += B32[parseInt(h.slice(i, i + 1), 16) % 32];
  }
  return `${out}.onion`;
}

/** PRNG determinista (mulberry32) a partir de un string. */
export function seededRng(seed: string): () => number {
  let a = parseInt(sha256Hex(seed).slice(0, 8), 16) >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

export function isOnionDomain(domain: string): boolean {
  return ONION_DOMAIN_RE.test(domain.trim().toLowerCase());
}

export interface NormalizedOnion {
  url: string; // http://domain.onion/path
  domain: string; // domain.onion
  base: string; // http://domain.onion
}

/**
 * Normaliza una URL .onion. Acepta entradas con o sin esquema.
 * Devuelve null si no apunta a un servicio oculto válido.
 */
export function normalizeOnionUrl(raw: string): NormalizedOnion | null {
  let s = raw.trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `http://${s}`;
  try {
    const u = new URL(s);
    const domain = u.hostname.toLowerCase();
    if (!isOnionDomain(domain)) return null;
    const path = (u.pathname || "/").replace(/\/{2,}/g, "/");
    const base = `http://${domain}`;
    const url = `${base}${path === "/" ? "/" : path.replace(/\/+$/, "")}`;
    return { url, domain, base };
  } catch {
    return null;
  }
}

export function onionDomainOf(url: string): string | null {
  try {
    const d = new URL(url).hostname.toLowerCase();
    return isOnionDomain(d) ? d : null;
  } catch {
    return null;
  }
}

/** Texto de contenido normalizado → hash para deduplicación de mirrors. */
export function contentFingerprint(text: string): string {
  const norm = text
    .toLowerCase()
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20000);
  return sha256Hex(norm);
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

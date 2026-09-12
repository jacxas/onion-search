// FARO — utilidades .onion: validación/normalización, fingerprints y PRNG
// determinista (base de la red simulada). Migrado de crawler/spider.py +
// health_checker/checker.py (lógica de dedupe SHA-256).

import { createHash, randomBytes } from "node:crypto";

const ONION_HOST_RE = /^[a-z2-7]{16,56}\.onion$/;

export interface NormalizedUrl {
  ok: true;
  url: string; // URL canónica completa (sin fragment)
  domain: string; // host .onion en minúsculas
  path: string; // path + query, "/" por defecto
}

export interface UrlError {
  ok: false;
  error: string;
}

/**
 * Normaliza una URL .onion: agrega http:// si falta, exige host .onion
 * válido (v2 o v3), minúsculas, sin fragment. Acepta v2 (16) y v3 (56).
 */
export function normalizeOnionUrl(raw: string): NormalizedUrl | UrlError {
  if (!raw || typeof raw !== "string") return { ok: false, error: "empty" };
  let s = raw.trim();
  if (!s) return { ok: false, error: "empty" };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = "http://" + s;

  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, error: "unparseable" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, error: "scheme" };
  }
  const host = u.hostname.toLowerCase();
  if (!host.endsWith(".onion") || !ONION_HOST_RE.test(host)) {
    return { ok: false, error: "not_onion" };
  }
  u.hash = "";
  u.hostname = host;
  const path = u.pathname === "/" && u.search === "" ? "/" : `${u.pathname}${u.search}`;
  return { ok: true, url: u.toString(), domain: host, path };
}

export function isOnionUrl(raw: string): boolean {
  return normalizeOnionUrl(raw).ok;
}

/** Dominio .onion de una URL ya válida (sin revalidar). */
export function onionDomainOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Normaliza contenido para deduplicación: mismo texto ⇒ mismo fingerprint. */
export function normalizeContent(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Fingerprint SHA-256 del contenido normalizado (dedupe / mirror grouping). */
export function contentFingerprint(text: string): string {
  return sha256Hex(normalizeContent(text));
}

// ── PRNG determinista ────────────────────────────────────────────────────
// mulberry32: rápido, seedable, mismo resultado en cada ejecución.

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** PRNG a partir de un string (mismo string ⇒ misma secuencia). */
export function makeRng(seed: string): Rng {
  return mulberry32(parseInt(sha256Hex(seed).slice(0, 8), 16));
}

const B32 = "abcdefghijklmnopqrstuvwxyz234567";

/** Host .onion v3 (56 chars base32) determinista a partir del rng. */
export function randomOnionHost(rng: Rng): string {
  let h = "";
  for (let i = 0; i < 56; i++) h += B32[Math.floor(rng() * 32)];
  return `${h}.onion`;
}

/** Token aleatorio criptográfico (sesiones). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

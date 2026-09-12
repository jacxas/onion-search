// FARO — fetch de una URL onion vía transporte (tor/sim) + parse HTML.
// Timeouts largos y reintentos limitados (legacy: backoff exponencial).

import { getConfig } from "../lib/config";
import type { OnionTransport, TransportResponse } from "../lib/tor/transport";
import { parsePage, type ParsedPage } from "./parse";

export interface FetchParseResult {
  url: string;
  status: number;
  elapsedMs: number;
  parsed: ParsedPage | null;
  error: string | null;
}

function looksLikeHtml(body: string, contentType: string | null): boolean {
  if (contentType && /text\/html|application\/xhtml/i.test(contentType)) return true;
  return /^\s*<(!doctype|html)/i.test(body.slice(0, 200));
}

/** Un intento de fetch+parse. Sin reintentos aquí: los maneja el pipeline. */
export async function fetchAndParse(
  transport: OnionTransport,
  url: string,
  timeoutMs?: number
): Promise<FetchParseResult> {
  const res: TransportResponse = await transport.fetch(url, { timeoutMs });
  if (!res.ok || !res.body) {
    return { url, status: res.status, elapsedMs: res.elapsedMs, parsed: null, error: res.error ?? `http_${res.status}` };
  }
  if (!looksLikeHtml(res.body, res.contentType)) {
    return { url, status: res.status, elapsedMs: res.elapsedMs, parsed: null, error: "not_html" };
  }
  const parsed = parsePage(res.body, url);
  return { url, status: res.status, elapsedMs: res.elapsedMs, parsed, error: null };
}

/** Fetch con reintentos + backoff exponencial (migrado de tor_session.py). */
export async function fetchWithRetry(
  transport: OnionTransport,
  url: string,
  maxRetries = 2,
  onRetry?: (attempt: number, error: string) => void
): Promise<FetchParseResult> {
  const cfg = getConfig();
  let last: FetchParseResult | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    last = await fetchAndParse(transport, url, cfg.crawl.timeoutMs);
    if (!last.error) return last;
    // 404 o no-HTML no valen reintento
    if (last.status === 404 || last.error === "not_html") return last;
    if (attempt < maxRetries) {
      onRetry?.(attempt + 1, last.error);
      await new Promise((r) => setTimeout(r, Math.min(4000 * 2 ** attempt, 10_000)));
    }
  }
  return last!;
}

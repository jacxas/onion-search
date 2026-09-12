// FARO — transporte abstracto. TorTransport (producción) vía SOCKS5 socks5h,
// SimTransport (desarrollo/test determinista). Interfaz única para el crawler.
//
// REL-01 — seguimiento EXPLÍCITO de redirects: cada salto 3xx lee Location,
// lo resuelve contra la URL actual y lo revalida con normalizeOnionUrl()
// (solo .onion; clearnet/IPs privadas se rechazan ANTES de conectarse).
// Límite de saltos + detección de loops + timeout por salto.

import { getConfig, type CrawlMode } from "../config";
import { normalizeOnionUrl } from "../onion";
import { makeSimTransport } from "./sim";

export interface TransportFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
}

export interface TransportResponse {
  url: string; // URL final (tras redirects seguidos)
  ok: boolean; // 2xx recibido
  status: number; // 0 si error de red
  body: string | null;
  contentType: string | null;
  elapsedMs: number;
  error: string | null;
}

export interface OnionTransport {
  readonly mode: CrawlMode;
  readonly name: string;
  fetch(url: string, opts?: TransportFetchOptions): Promise<TransportResponse>;
}

const UA =
  "Mozilla/5.0 (compatible; FAROBot/1.0; +https://github.com/jacxas/onion-search)";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECT_HOPS = 5;

async function parseProxy(proxyUrl: string): Promise<{ host: string; port: number; type: 5 }> {
  const u = new URL(proxyUrl);
  return { host: u.hostname, port: Number(u.port || "9050"), type: 5 };
}

/** Transporte live: fetch HTTP(S) a través del proxy SOCKS5 de Tor (DNS remoto). */
export function makeTorTransport(proxyUrl: string): OnionTransport {
  let dispatcherPromise: Promise<unknown> | null = null;

  async function getDispatcher(): Promise<unknown> {
    if (!dispatcherPromise) {
      dispatcherPromise = (async () => {
        const { socksDispatcher } = await import("fetch-socks");
        const proxy = await parseProxy(proxyUrl);
        return socksDispatcher(proxy);
      })();
    }
    return dispatcherPromise;
  }

  return {
    mode: "live",
    name: `tor(${proxyUrl})`,
    async fetch(url, opts = {}) {
      const timeoutMs = opts.timeoutMs ?? getConfig().crawl.timeoutMs;
      const maxBytes = opts.maxBytes ?? 512 * 1024;
      const started = Date.now();
      const fail = (status: number, error: string, at: string) => ({
        url: at,
        ok: false,
        status,
        body: null,
        contentType: null,
        elapsedMs: Date.now() - started,
        error,
      });

      try {
        const dispatcher = await getDispatcher();
        let current = url;
        const visited = new Set<string>([url]);

        for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
          const res = await fetch(current, {
            method: "GET",
            redirect: "manual",
            headers: {
              "User-Agent": UA,
              Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
            dispatcher: dispatcher as never, // undici: dispatcher en RequestInit
            signal: AbortSignal.timeout(timeoutMs),
          } as RequestInit & { dispatcher: unknown });

          // ── salto de redirect: revalidar ANTES de seguir ──
          if (REDIRECT_STATUSES.has(res.status)) {
            const location = res.headers.get("location");
            await res.body?.cancel().catch(() => {});
            if (!location) return fail(res.status, `http_${res.status}_sin_location`, current);
            let next: string;
            try {
              next = new URL(location, current).toString();
            } catch {
              return fail(res.status, "redirect_location_invalida", current);
            }
            const n = normalizeOnionUrl(next);
            if (!n.ok) return fail(res.status, `redirect_rechazado:${n.error}`, current);
            if (visited.has(n.url)) return fail(res.status, "redirect_loop", current);
            if (hop === MAX_REDIRECT_HOPS) return fail(res.status, "redirect_max_hops", current);
            visited.add(n.url);
            current = n.url;
            continue;
          }

          // ── respuesta final ──
          const contentType = res.headers.get("content-type");
          let body: string | null = null;
          if (res.body) {
            const text = await res.text();
            body = text.length > maxBytes ? text.slice(0, maxBytes) : text;
          }
          return {
            url: current,
            ok: res.ok,
            status: res.status,
            body,
            contentType,
            elapsedMs: Date.now() - started,
            error: null,
          };
        }
        return fail(0, "redirect_max_hops", current);
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        return {
          url,
          ok: false,
          status: 0,
          body: null,
          contentType: null,
          elapsedMs: Date.now() - started,
          error: err,
        };
      }
    },
  };
}

/** Factory por CRAWL_MODE (o explícito para tests). */
export function getTransport(mode?: CrawlMode): OnionTransport {
  const cfg = getConfig();
  const m = mode ?? cfg.crawlMode;
  if (m === "sim") return makeSimTransport();
  return makeTorTransport(cfg.torSocksProxy);
}

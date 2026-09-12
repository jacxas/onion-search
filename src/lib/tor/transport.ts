// FARO — transporte abstracto. TorTransport (producción) vía SOCKS5 socks5h,
// SimTransport (desarrollo/test determinista). Interfaz única para el crawler.

import { getConfig, type CrawlMode } from "../config";
import { makeSimTransport } from "./sim";

export interface TransportFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
}

export interface TransportResponse {
  url: string; // URL solicitada (sin redirects: manual)
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
      try {
        const dispatcher = await getDispatcher();
        const res = await fetch(url, {
          method: "GET",
          redirect: "manual", // los .onion redirigen raro; seguimos manual
          headers: {
            "User-Agent": UA,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
          dispatcher: dispatcher as never, // undici: dispatcher en RequestInit
          signal: AbortSignal.timeout(timeoutMs),
        } as RequestInit & { dispatcher: unknown });

        const contentType = res.headers.get("content-type");
        let body: string | null = null;
        if (res.body) {
          const text = await res.text();
          body = text.length > maxBytes ? text.slice(0, maxBytes) : text;
        }
        return {
          url,
          ok: res.ok,
          status: res.status,
          body,
          contentType,
          elapsedMs: Date.now() - started,
          error: null,
        };
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

import { socksDispatcher } from "fetch-socks";
import { simFetch } from "@/lib/tor/sim";

export interface FetchOutcome {
  ok: boolean;
  httpStatus: number;
  responseMs: number;
  html?: string;
  finalUrl: string;
  error?: string;
}

export const CRAWL_MODE =
  (process.env.CRAWL_MODE ?? "sim").toLowerCase() === "live" ? "live" : "sim";

// Acepta TOR_SOCKS_PROXY completo o el par host/port (compat con scaffold)
export const TOR_SOCKS_PROXY =
  process.env.TOR_SOCKS_PROXY ??
  (process.env.TOR_SOCKS_HOST
    ? `socks5h://${process.env.TOR_SOCKS_HOST}:${process.env.TOR_SOCKS_PORT ?? 9050}`
    : "socks5h://127.0.0.1:9050");

/** Parsea socks5[h]://[user:pass@]host:port → SocksProxy del paquete `socks`. */
function parseSocksProxy(raw: string) {
  const u = new URL(raw.replace(/^socks5h/i, "socks5"));
  return {
    host: u.hostname,
    port: Number(u.port || 9050),
    type: 5 as const,
    ...(u.username ? { userId: decodeURIComponent(u.username) } : {}),
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
  };
}

/**
 * Transporte real: enruta la petición a través del proxy SOCKS5 de Tor.
 * Requiere el demonio tor corriendo (SocksPort). El paquete `socks` envía
 * el nombre de dominio al proxy (semántica socks5h) — imprescindible para
 * .onion, que no se resuelve por DNS público.
 */
async function fetchViaTor(url: string, timeoutMs: number): Promise<FetchOutcome> {
  const target = url.startsWith("http") ? url : `http://${url}`;
  const started = Date.now();
  try {
    const dispatcher = socksDispatcher([parseSocksProxy(TOR_SOCKS_PROXY)]);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(target, {
        signal: ctrl.signal,
        redirect: "follow",
        headers: {
          "User-Agent": "faro-crawler/0.2 (+research crawler)",
          Accept: "text/html,application/xhtml+xml",
        },
        // dispatcher es opción específica de undici en runtime Node
        dispatcher,
      } as RequestInit & { dispatcher: unknown });
      const ms = Date.now() - started;
      const html = await res.text();
      return {
        ok: res.status >= 200 && res.status < 400,
        httpStatus: res.status,
        responseMs: ms,
        html,
        finalUrl: res.url || target,
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const ms = Date.now() - started;
    const msg =
      err instanceof Error
        ? err.name === "AbortError"
          ? `timeout tras ${timeoutMs}ms`
          : err.message
        : "error desconocido";
    return { ok: false, httpStatus: 0, responseMs: ms, finalUrl: target, error: msg };
  }
}

async function fetchSim(url: string, timeoutMs: number): Promise<FetchOutcome> {
  const r = simFetch(url);
  const target = url.startsWith("http") ? url : `http://${url}`;
  if (!r.ok) {
    return {
      ok: false,
      httpStatus: 0,
      responseMs: Math.min(r.ms, timeoutMs),
      finalUrl: target,
      error: r.error ?? "fallo simulado",
    };
  }
  return {
    ok: true,
    httpStatus: r.status,
    responseMs: r.ms,
    html: r.html,
    finalUrl: target,
  };
}

export async function torFetch(url: string, timeoutMs = 30000): Promise<FetchOutcome> {
  return CRAWL_MODE === "live" ? fetchViaTor(url, timeoutMs) : fetchSim(url, timeoutMs);
}

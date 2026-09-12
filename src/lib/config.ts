// FARO — configuración central. Lee de process.env con defaults seguros.
// No usa alias de path (compatibilidad con el worker en Node puro).

export type CrawlMode = "sim" | "live";

export interface MailConfig {
  service: "gmail" | "smtp";
  host?: string;
  port: number;
  username: string;
  password: string;
  alertTo: string;
}

export interface MeiliConfig {
  url: string;
  apiKey?: string;
  index: string;
}

export interface AppConfig {
  databaseUrl: string | null;
  crawlMode: CrawlMode;
  torSocksProxy: string;
  torSeedUrls: string[];
  adminInitialEmail: string;
  adminInitialPassword: string;
  adminToken: string | null;
  csrfEnabled: boolean;
  secureCookies: boolean;
  mail: MailConfig | null;
  meili: MeiliConfig | null;
  crawl: {
    maxDepth: number;
    domainCap: number;
    timeoutMs: number;
  };
  health: {
    timeoutMs: number;
    intervalMin: number;
  };
}

function num(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === "") return fallback;
  return v === "true" || v === "1";
}

function parseSeeds(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseProxy(): string {
  const direct = process.env.TOR_SOCKS_PROXY;
  if (direct && direct.trim()) return direct.trim();
  const host = process.env.TOR_SOCKS_HOST || "127.0.0.1";
  const port = process.env.TOR_SOCKS_PORT || "9050";
  return `socks5h://${host}:${port}`;
}

let cached: AppConfig | null = null;

/** Config parseada y cacheada. `force` re-lee (tests). */
export function getConfig(force = false): AppConfig {
  if (cached && !force) return cached;

  const mode = process.env.CRAWL_MODE === "live" ? "live" : "sim";

  const mailUser = process.env.MAIL_USERNAME;
  const mailPass = process.env.MAIL_PASSWORD;
  const mailTo = process.env.MAIL_ALERT_TO;

  cached = {
    databaseUrl: process.env.DATABASE_URL || null,
    crawlMode: mode,
    torSocksProxy: parseProxy(),
    torSeedUrls: parseSeeds(process.env.TOR_SEED_URLS),
    adminInitialEmail: process.env.ADMIN_INITIAL_EMAIL || "admin@faro.local",
    adminInitialPassword: process.env.ADMIN_INITIAL_PASSWORD || "faro-admin-123",
    adminToken: process.env.ADMIN_TOKEN || null,
    csrfEnabled: bool(process.env.CSRF_ENABLED, true),
    secureCookies: bool(process.env.SECURE_COOKIES, false),
    mail:
      mailUser && mailPass && mailTo
        ? {
            service: process.env.MAIL_HOST ? "smtp" : "gmail",
            host: process.env.MAIL_HOST || undefined,
            port: num(process.env.MAIL_PORT, 587),
            username: mailUser,
            password: mailPass,
            alertTo: mailTo,
          }
        : null,
    meili: process.env.MEILI_URL
      ? {
          url: process.env.MEILI_URL,
          apiKey: process.env.MEILI_MASTER_KEY || undefined,
          index: process.env.MEILI_INDEX || "onion_pages",
        }
      : null,
    crawl: {
      maxDepth: num(process.env.CRAWL_MAX_DEPTH, 2),
      domainCap: num(process.env.CRAWL_DOMAIN_CAP, 12),
      timeoutMs: num(process.env.CRAWL_TIMEOUT_MS, 30_000),
    },
    health: {
      timeoutMs: num(process.env.HEALTH_TIMEOUT_MS, 20_000),
      intervalMin: num(process.env.HEALTH_INTERVAL_MIN, 45),
    },
  };
  return cached;
}

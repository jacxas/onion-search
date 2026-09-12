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
  isProduction: boolean;
  databaseUrl: string | null;
  crawlMode: CrawlMode;
  torSocksProxy: string;
  torSeedUrls: string[];
  adminInitialEmail: string;
  adminInitialPassword: string | null;
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

// Contraseñas conocidas/default que jamás pueden usarse como credencial
// inicial de admin en producción (SEC-01).
const KNOWN_DEFAULT_PASSWORDS = new Set([
  "faro-admin-123", "admin", "password", "changeme", "12345678", "admin123",
]);

/**
 * Valida las credenciales del bootstrap inicial de admin (SEC-01).
 * En producción son obligatorias y no pueden ser conocidas/default;
 * en desarrollo se mantiene el comportamiento cómodo con defaults.
 * Solo aplica al PRIMER arranque (tabla admin_users vacía): después
 * la autenticación vive en la DB (hash scrypt) y no depende del entorno.
 */
export function validateAdminBootstrap(
  email: string | null,
  password: string | null
): { ok: true } | { ok: false; error: string } {
  if (process.env.NODE_ENV !== "production") return { ok: true };
  if (!email || !password) {
    return { ok: false, error: "producción sin ADMIN_INITIAL_EMAIL/ADMIN_INITIAL_PASSWORD — definirlos antes del primer arranque" };
  }
  if (password.length < 8) {
    return { ok: false, error: "ADMIN_INITIAL_PASSWORD debe tener al menos 8 caracteres" };
  }
  if (KNOWN_DEFAULT_PASSWORDS.has(password)) {
    return { ok: false, error: "ADMIN_INITIAL_PASSWORD es una contraseña conocida — definir una contraseña real" };
  }
  return { ok: true };
}

let cached: AppConfig | null = null;

/** Config parseada y cacheada. `force` re-lee (tests). */
export function getConfig(force = false): AppConfig {
  if (cached && !force) return cached;

  const mode = process.env.CRAWL_MODE === "live" ? "live" : "sim";
  const isProduction = process.env.NODE_ENV === "production";

  const mailUser = process.env.MAIL_USERNAME;
  const mailPass = process.env.MAIL_PASSWORD;
  const mailTo = process.env.MAIL_ALERT_TO;

  cached = {
    isProduction,
    databaseUrl: process.env.DATABASE_URL || null,
    crawlMode: mode,
    torSocksProxy: parseProxy(),
    torSeedUrls: parseSeeds(process.env.TOR_SEED_URLS),
    // En desarrollo: defaults cómodos. En producción: obligatorio por env
    // (validado en el bootstrap, sin fallback de contraseña conocida).
    adminInitialEmail: process.env.ADMIN_INITIAL_EMAIL || "admin@faro.local",
    adminInitialPassword: isProduction
      ? process.env.ADMIN_INITIAL_PASSWORD || null
      : process.env.ADMIN_INITIAL_PASSWORD || "faro-admin-123",
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

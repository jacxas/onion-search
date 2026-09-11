import {
  pgTable,
  serial,
  integer,
  real,
  boolean,
  text,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Agregado por dominio .onion (servicio oculto).
 * El estado online/offline y el uptime se alimentan del health checker.
 */
export const onionSites = pgTable(
  "onion_sites",
  {
    id: serial("id").primaryKey(),
    url: text("url").notNull(), // http://<domain>.onion
    domain: text("domain").notNull(), // <56 chars>.onion
    title: text("title"),
    description: text("description"),
    contentHash: text("content_hash"),
    // mirror grouping: si no es null, este sitio es espejo del canónico
    canonicalId: integer("canonical_id"),
    status: text("status").notNull().default("unknown"), // online | offline | unknown
    uptimeRatio: real("uptime_ratio").notNull().default(0),
    avgResponseMs: integer("avg_response_ms"),
    checksTotal: integer("checks_total").notNull().default(0),
    checksOk: integer("checks_ok").notNull().default(0),
    isBlocked: boolean("is_blocked").notNull().default(false),
    blockedReason: text("blocked_reason"),
    isSeed: boolean("is_seed").notNull().default(false),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastCrawledAt: timestamp("last_crawled_at", { withTimezone: true }),
    lastOnlineAt: timestamp("last_online_at", { withTimezone: true }),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("onion_sites_domain_uidx").on(t.domain),
    index("onion_sites_status_idx").on(t.status),
    index("onion_sites_hash_idx").on(t.contentHash),
  ],
);

/**
 * Páginas indexadas (una fila por URL rastreada con éxito).
 */
export const pages = pgTable(
  "pages",
  {
    id: serial("id").primaryKey(),
    siteId: integer("site_id")
      .notNull()
      .references(() => onionSites.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    title: text("title"),
    description: text("description"),
    contentText: text("content_text"),
    contentHash: text("content_hash"),
    httpStatus: integer("http_status"),
    depth: integer("depth").notNull().default(0),
    crawledAt: timestamp("crawled_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("pages_url_uidx").on(t.url),
    index("pages_site_idx").on(t.siteId),
  ],
);

/**
 * Historial de verificaciones del health checker.
 */
export const healthChecks = pgTable(
  "health_checks",
  {
    id: serial("id").primaryKey(),
    siteId: integer("site_id")
      .notNull()
      .references(() => onionSites.id, { onDelete: "cascade" }),
    checkedAt: timestamp("checked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    online: boolean("online").notNull(),
    httpStatus: integer("http_status"),
    responseMs: integer("response_ms"),
    error: text("error"),
  },
  (t) => [index("health_checks_site_idx").on(t.siteId, t.checkedAt)],
);

/**
 * Cola de rastreo: el crawler consume de acá con backoff exponencial.
 */
export const crawlQueue = pgTable(
  "crawl_queue",
  {
    id: serial("id").primaryKey(),
    url: text("url").notNull(),
    domain: text("domain").notNull(),
    priority: integer("priority").notNull().default(0),
    status: text("status").notNull().default("pending"), // pending | running | done | failed | blocked
    attempts: integer("attempts").notNull().default(0),
    depth: integer("depth").notNull().default(0),
    nextRunAt: timestamp("next_run_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("crawl_queue_url_uidx").on(t.url),
    index("crawl_queue_pick_idx").on(t.status, t.nextRunAt),
  ],
);

/**
 * Blocklists: dominios, hashes de contenido (CSAM/scams conocidos)
 * y keywords prohibidas en título/cuerpo.
 */
export const blocklist = pgTable(
  "blocklist",
  {
    id: serial("id").primaryKey(),
    type: text("type").notNull(), // domain | hash | keyword
    value: text("value").notNull(),
    reason: text("reason"),
    source: text("source").default("local"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("blocklist_value_uidx").on(t.type, t.value),
    index("blocklist_type_idx").on(t.type),
  ],
);

/**
 * Reportes de usuarios (sitios maliciosos, spam, ilegal).
 */
export const reports = pgTable(
  "reports",
  {
    id: serial("id").primaryKey(),
    url: text("url").notNull(),
    reason: text("reason").notNull(), // spam | ilegal | scam | offline | otro
    details: text("details"),
    status: text("status").notNull().default("open"), // open | resolved | dismissed
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("reports_status_idx").on(t.status)],
);

/**
 * Usuarios administradores. El primero se crea desde ADMIN_INITIAL_EMAIL /
 * ADMIN_INITIAL_PASSWORD al primer arranque (cambiar la clave después).
 */
export const adminUsers = pgTable(
  "admin_users",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(), // scrypt: salt:hash (hex)
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("admin_users_email_uidx").on(t.email)],
);

/**
 * Sesiones firmadas: en la cookie viaja el token crudo; acá se guarda su hash.
 */
export const adminSessions = pgTable(
  "admin_sessions",
  {
    id: serial("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    userId: integer("user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("admin_sessions_token_uidx").on(t.tokenHash)],
);

/**
 * Bitácora de actividad del pipeline (para el panel de operaciones).
 */
export const crawlEvents = pgTable(
  "crawl_events",
  {
    id: serial("id").primaryKey(),
    type: text("type").notNull(), // crawl | health | discover | block | seed | system
    message: text("message").notNull(),
    siteId: integer("site_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("crawl_events_created_idx").on(t.createdAt)],
);

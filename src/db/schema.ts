// FARO — esquema PostgreSQL (Drizzle). Source of truth.
// Migrado de db/models.py (OnionSite/Blocklist) ampliado para FARO:
// cola persistente, historial de salud, espejos, sesiones y reportes.

import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  integer,
  text,
  varchar,
  boolean,
  timestamp,
  doublePrecision,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** Sitio .onion (agregado por dominio) con estado de salud y espejos. */
export const sites = pgTable(
  "sites",
  {
    id: serial("id").primaryKey(),
    domain: varchar("domain", { length: 64 }).notNull(),
    url: text("url").notNull(), // landing canónica http(s)://domain/
    title: text("title").notNull().default(""),
    description: text("description"),
    statusCode: integer("status_code").notNull().default(0),
    online: boolean("online").notNull().default(false),
    blocked: boolean("blocked").notNull().default(false),
    blockReason: text("block_reason"),
    contentHash: varchar("content_hash", { length: 64 }), // fingerprint landing
    mirrorGroupId: integer("mirror_group_id"), // grupo de espejos (min id del grupo)
    lastResponseMs: integer("last_response_ms"),
    avgResponseMs: integer("avg_response_ms"),
    uptimeRatio: doublePrecision("uptime_ratio").notNull().default(0),
    totalChecks: integer("total_checks").notNull().default(0),
    successfulChecks: integer("successful_checks").notNull().default(0),
    isSeed: boolean("is_seed").notNull().default(false),
    discoveredAt: ts("discovered_at").notNull().defaultNow(),
    lastCrawledAt: ts("last_crawled_at"),
    lastCheckedAt: ts("last_checked_at"),
    lastOnlineAt: ts("last_online_at"),
  },
  (t) => [
    uniqueIndex("sites_domain_key").on(t.domain),
    index("sites_online_idx").on(t.online),
    index("sites_uptime_idx").on(t.uptimeRatio),
    index("sites_hash_idx").on(t.contentHash),
    index("sites_mirror_idx").on(t.mirrorGroupId),
    index("sites_checked_idx").on(t.lastCheckedAt),
  ]
);

/** Página individual rastreada (contenido indexado por FTS). */
export const pages = pgTable(
  "pages",
  {
    id: serial("id").primaryKey(),
    siteId: integer("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    path: text("path").notNull().default("/"),
    title: text("title").notNull().default(""),
    description: text("description"),
    content: text("content").notNull().default(""),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    depth: integer("depth").notNull().default(0),
    linksFound: integer("links_found").notNull().default(0),
    crawledAt: ts("crawled_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pages_url_key").on(t.url),
    index("pages_site_idx").on(t.siteId),
    index("pages_hash_idx").on(t.contentHash),
    // FTS: la expresión debe coincidir EXACTAMENTE con tsvectorExpr de src/lib/search.ts
    index("pages_fts_idx").using("gin", sql`to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || content)`),
  ]
);

/** Cola de rastreo persistente (discover → fetch → done/failed/blocked). */
export const crawlQueue = pgTable(
  "crawl_queue",
  {
    id: serial("id").primaryKey(),
    url: text("url").notNull(),
    domain: varchar("domain", { length: 64 }).notNull(),
    depth: integer("depth").notNull().default(0),
    priority: integer("priority").notNull().default(0), // seeds > descubiertos
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    discoveredAt: ts("discovered_at").notNull().defaultNow(),
    processedAt: ts("processed_at"),
  },
  (t) => [
    uniqueIndex("crawl_queue_url_key").on(t.url),
    index("crawl_queue_status_idx").on(t.status),
    index("crawl_queue_priority_idx").on(t.priority),
  ]
);

/** Blocklist por dominio/URL o hash de contenido (migrado de db/models.py). */
export const blocklist = pgTable(
  "blocklist",
  {
    id: serial("id").primaryKey(),
    pattern: varchar("pattern", { length: 255 }).notNull(), // dominio o URL exacta
    contentHash: varchar("content_hash", { length: 64 }),
    reason: text("reason").notNull().default("manual"),
    addedAt: ts("added_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("blocklist_pattern_key").on(t.pattern), index("blocklist_hash_idx").on(t.contentHash)]
);

/** Reportes de usuarios (migrado del backend legacy). */
export const reports = pgTable(
  "reports",
  {
    id: serial("id").primaryKey(),
    url: text("url").notNull(),
    reason: varchar("reason", { length: 100 }).notNull(),
    details: text("details"),
    reporterEmail: text("reporter_email"),
    status: varchar("status", { length: 16 }).notNull().default("open"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("reports_status_idx").on(t.status)]
);

/** Historial de salud: últimos ~100 checks por sitio. */
export const healthChecks = pgTable(
  "health_checks",
  {
    id: serial("id").primaryKey(),
    siteId: integer("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    statusCode: integer("status_code").notNull().default(0),
    online: boolean("online").notNull().default(false),
    responseMs: integer("response_ms"),
    error: text("error"),
    checkedAt: ts("checked_at").notNull().defaultNow(),
  },
  (t) => [index("health_checks_site_idx").on(t.siteId, t.checkedAt)]
);

/** Admins: scrypt + cambio de clave invalida sesiones. */
export const adminUsers = pgTable(
  "admin_users",
  {
    id: serial("id").primaryKey(),
    email: varchar("email", { length: 255 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    passwordChangedAt: ts("password_changed_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("admin_users_email_key").on(t.email)]
);

/** Sesiones: cookie con token aleatorio; DB guarda solo hash SHA-256. */
export const sessions = pgTable(
  "sessions",
  {
    id: serial("id").primaryKey(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    adminUserId: integer("admin_user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    ip: varchar("ip", { length: 64 }),
    userAgent: text("user_agent"),
    createdAt: ts("created_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [uniqueIndex("sessions_token_key").on(t.tokenHash), index("sessions_user_idx").on(t.adminUserId)]
);

/** Rate-limit de login persistente (6 intentos / 10 min por email). */
export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: serial("id").primaryKey(),
    email: varchar("email", { length: 255 }).notNull(),
    ip: varchar("ip", { length: 64 }),
    at: ts("at").notNull().defaultNow(),
  },
  (t) => [index("login_attempts_email_idx").on(t.email, t.at)]
);

/** Throttle de alertas email: no repetir alerta de un mismo key. */
export const alertsLog = pgTable(
  "alerts_log",
  {
    id: serial("id").primaryKey(),
    kind: varchar("kind", { length: 32 }).notNull(), // offline|recovered|block|report
    key: varchar("key", { length: 255 }).notNull(), // dominio o url
    sentAt: ts("sent_at").notNull().defaultNow(),
  },
  (t) => [index("alerts_log_key_idx").on(t.kind, t.key, t.sentAt)]
);

export type Site = typeof sites.$inferSelect;
export type Page = typeof pages.$inferSelect;
export type QueueItem = typeof crawlQueue.$inferSelect;
export type HealthCheck = typeof healthChecks.$inferSelect;
export type AdminUser = typeof adminUsers.$inferSelect;

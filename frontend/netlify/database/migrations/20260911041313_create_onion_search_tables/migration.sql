CREATE TABLE "admin_sessions" (
	"id" serial PRIMARY KEY,
	"token_hash" text NOT NULL,
	"user_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" serial PRIMARY KEY,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "blocklist" (
	"id" serial PRIMARY KEY,
	"type" text NOT NULL,
	"value" text NOT NULL,
	"reason" text,
	"source" text DEFAULT 'local',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crawl_events" (
	"id" serial PRIMARY KEY,
	"type" text NOT NULL,
	"message" text NOT NULL,
	"site_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crawl_queue" (
	"id" serial PRIMARY KEY,
	"url" text NOT NULL,
	"domain" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_checks" (
	"id" serial PRIMARY KEY,
	"site_id" integer NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"online" boolean NOT NULL,
	"http_status" integer,
	"response_ms" integer,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "onion_sites" (
	"id" serial PRIMARY KEY,
	"url" text NOT NULL,
	"domain" text NOT NULL,
	"title" text,
	"description" text,
	"content_hash" text,
	"canonical_id" integer,
	"status" text DEFAULT 'unknown' NOT NULL,
	"uptime_ratio" real DEFAULT 0 NOT NULL,
	"avg_response_ms" integer,
	"checks_total" integer DEFAULT 0 NOT NULL,
	"checks_ok" integer DEFAULT 0 NOT NULL,
	"is_blocked" boolean DEFAULT false NOT NULL,
	"blocked_reason" text,
	"is_seed" boolean DEFAULT false NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_crawled_at" timestamp with time zone,
	"last_online_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"id" serial PRIMARY KEY,
	"site_id" integer NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"description" text,
	"content_text" text,
	"content_hash" text,
	"http_status" integer,
	"depth" integer DEFAULT 0 NOT NULL,
	"crawled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" serial PRIMARY KEY,
	"url" text NOT NULL,
	"reason" text NOT NULL,
	"details" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "admin_sessions_token_uidx" ON "admin_sessions" ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_users_email_uidx" ON "admin_users" ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "blocklist_value_uidx" ON "blocklist" ("type","value");--> statement-breakpoint
CREATE INDEX "blocklist_type_idx" ON "blocklist" ("type");--> statement-breakpoint
CREATE INDEX "crawl_events_created_idx" ON "crawl_events" ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "crawl_queue_url_uidx" ON "crawl_queue" ("url");--> statement-breakpoint
CREATE INDEX "crawl_queue_pick_idx" ON "crawl_queue" ("status","next_run_at");--> statement-breakpoint
CREATE INDEX "health_checks_site_idx" ON "health_checks" ("site_id","checked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "onion_sites_domain_uidx" ON "onion_sites" ("domain");--> statement-breakpoint
CREATE INDEX "onion_sites_status_idx" ON "onion_sites" ("status");--> statement-breakpoint
CREATE INDEX "onion_sites_hash_idx" ON "onion_sites" ("content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "pages_url_uidx" ON "pages" ("url");--> statement-breakpoint
CREATE INDEX "pages_site_idx" ON "pages" ("site_id");--> statement-breakpoint
CREATE INDEX "reports_status_idx" ON "reports" ("status");--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_user_id_admin_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "admin_users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "health_checks" ADD CONSTRAINT "health_checks_site_id_onion_sites_id_fkey" FOREIGN KEY ("site_id") REFERENCES "onion_sites"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_site_id_onion_sites_id_fkey" FOREIGN KEY ("site_id") REFERENCES "onion_sites"("id") ON DELETE CASCADE;
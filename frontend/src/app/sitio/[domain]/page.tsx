import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { healthChecks, onionSites, pages } from "@/db/schema";
import { StatusDot, UptimeBar } from "@/components/indicators";
import { ReportForm } from "@/components/ops-client";
import { recrawlAction, blockDomainAction } from "@/app/actions";
import { fmtMs, fmtPct, timeAgoEs } from "@/lib/format";
import {
  ArrowLeft,
  RefreshCcw,
  Ban,
  CalendarClock,
  Gauge,
  HeartPulse,
  Layers,
  FileText,
} from "lucide-react";

export const dynamic = "force-dynamic";

export default async function SitePage({
  params,
}: {
  params: Promise<{ domain: string }>;
}) {
  const { domain: raw } = await params;
  const domain = decodeURIComponent(raw).toLowerCase();

  const siteRows = await db
    .select()
    .from(onionSites)
    .where(eq(onionSites.domain, domain))
    .limit(1)
    .catch(() => []);
  const site = siteRows[0];
  if (!site) notFound();

  const [checks, mirrors, sitePages, canonicalRow] = await Promise.all([
    db
      .select()
      .from(healthChecks)
      .where(eq(healthChecks.siteId, site.id))
      .orderBy(desc(healthChecks.checkedAt))
      .limit(40),
    db
      .select()
      .from(onionSites)
      .where(eq(onionSites.canonicalId, site.id))
      .limit(20),
    db
      .select()
      .from(pages)
      .where(eq(pages.siteId, site.id))
      .orderBy(desc(pages.crawledAt))
      .limit(30),
    site.canonicalId
      ? db.select().from(onionSites).where(eq(onionSites.id, site.canonicalId)).limit(1)
      : Promise.resolve([]),
  ]);

  const orderedChecks = [...checks].reverse();
  const maxMs = Math.max(500, ...orderedChecks.map((c) => c.responseMs ?? 0));
  const canonical = canonicalRow[0];

  return (
    <div className="pt-10">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-[11px] tracking-wider text-faint uppercase transition-colors hover:text-accent"
      >
        <ArrowLeft size={12} /> volver al buscador
      </Link>

      <header className="card-panel mt-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-start gap-4">
          <StatusDot status={site.status} />
          <div className="min-w-0 flex-1">
            <h1 className="glow-soft font-display text-xl font-bold break-words text-ink sm:text-2xl">
              {site.title ?? domain}
            </h1>
            <p className="mt-1 font-mono text-xs break-all text-dim">{site.url}</p>
            {site.description && (
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-dim">{site.description}</p>
            )}
            {canonical && (
              <p className="mt-2 inline-flex items-center gap-1.5 rounded border border-amber/40 bg-amber/10 px-2 py-1 text-[11px] text-amber">
                <Layers size={11} /> espejo de <Link className="underline" href={`/sitio/${canonical.domain}`}>{canonical.domain.slice(0, 24)}…</Link>
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <span
              className="rounded border px-2.5 py-1 text-[10px] tracking-wider uppercase"
              style={{
                borderColor:
                  site.status === "online"
                    ? "rgba(82,255,168,0.4)"
                    : site.status === "offline"
                      ? "rgba(255,107,94,0.4)"
                      : "rgba(255,180,84,0.4)",
                color:
                  site.status === "online"
                    ? "var(--color-accent)"
                    : site.status === "offline"
                      ? "var(--color-red)"
                      : "var(--color-amber)",
                background:
                  site.status === "online"
                    ? "rgba(82,255,168,0.08)"
                    : site.status === "offline"
                      ? "rgba(255,107,94,0.08)"
                      : "rgba(255,180,84,0.08)",
              }}
            >
              {site.status === "online" ? "en línea" : site.status === "offline" ? "caído" : "desconocido"}
            </span>
            <UptimeBar ratio={site.uptimeRatio} />
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-4 sm:grid-cols-4">
          {[
            { icon: HeartPulse, label: "disponibilidad (100 checks)", value: fmtPct(site.uptimeRatio) },
            { icon: Gauge, label: "respuesta promedio", value: fmtMs(site.avgResponseMs) },
            { icon: CalendarClock, label: "última verificación", value: timeAgoEs(site.lastCheckedAt?.toISOString()) },
            { icon: FileText, label: "páginas indexadas", value: String(sitePages.length) },
          ].map((k) => (
            <div key={k.label}>
              <div className="flex items-center gap-1.5 text-[10px] tracking-wider text-faint uppercase">
                <k.icon size={11} /> {k.label}
              </div>
              <div className="mt-1 font-display text-lg font-bold text-ink">{k.value}</div>
            </div>
          ))}
        </div>
      </header>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          {/* historial de checks */}
          <section className="card-panel p-5">
            <h2 className="mb-4 text-[10px] tracking-[0.25em] text-faint uppercase">
              historial de verificaciones · últimas {orderedChecks.length}
            </h2>
            {orderedChecks.length === 0 ? (
              <p className="py-6 text-center text-xs text-faint">
                aún no hay verificaciones — ejecutá un health sweep.
              </p>
            ) : (
              <>
                <div className="flex h-24 items-end gap-1">
                  {orderedChecks.map((c) => (
                    <div
                      key={c.id}
                      title={`${new Date(c.checkedAt).toLocaleString("es-AR")} — ${c.online ? "OK" : "fallo"} · ${fmtMs(c.responseMs)}${c.error ? ` · ${c.error}` : ""}`}
                      className="flex-1 rounded-sm transition-transform hover:scale-y-105"
                      style={{
                        height: c.online
                          ? `${Math.max(12, ((c.responseMs ?? 100) / maxMs) * 100)}%`
                          : "10%",
                        background: c.online
                          ? "rgba(82,255,168,0.65)"
                          : "rgba(255,107,94,0.7)",
                      }}
                    />
                  ))}
                </div>
                <div className="mt-2 flex justify-between text-[10px] text-faint">
                  <span>{timeAgoEs(orderedChecks[0].checkedAt.toISOString())}</span>
                  <span>ahora</span>
                </div>
              </>
            )}
          </section>

          {/* páginas */}
          <section className="card-panel p-5">
            <h2 className="mb-3 text-[10px] tracking-[0.25em] text-faint uppercase">
              páginas indexadas
            </h2>
            {sitePages.length === 0 ? (
              <p className="py-6 text-center text-xs text-faint">sin páginas rastreadas</p>
            ) : (
              <ul className="space-y-2">
                {sitePages.map((p) => (
                  <li key={p.id} className="rounded border border-line/60 bg-void/60 px-3 py-2.5">
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="truncate text-sm text-accent hover:underline"
                    >
                      {p.title ?? "(sin título)"}
                    </a>
                    <div className="mt-1 flex items-center gap-3 font-mono text-[10px] text-faint">
                      <span className="truncate">{p.url}</span>
                      <span className="ml-auto shrink-0">{timeAgoEs(p.crawledAt.toISOString())}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="space-y-4">
          {/* acciones */}
          <section className="card-panel p-5">
            <h2 className="mb-3 text-[10px] tracking-[0.25em] text-faint uppercase">acciones</h2>
            <div className="flex flex-col gap-2">
              <form action={recrawlAction}>
                <input type="hidden" name="url" value={site.url} />
                <button className="btn btn-primary w-full justify-center">
                  <RefreshCcw size={13} /> re-encolar rastreo
                </button>
              </form>
              {!site.isBlocked && (
                <form action={blockDomainAction}>
                  <input type="hidden" name="domain" value={site.domain} />
                  <button className="btn w-full justify-center !border-red/40 !text-red hover:!border-red">
                    <Ban size={13} /> bloquear dominio
                  </button>
                </form>
              )}
              {site.isBlocked && (
                <p className="rounded border border-red/40 bg-red/10 px-3 py-2 text-[11px] text-red">
                  dominio bloqueado — {site.blockedReason ?? "blocklist"}
                </p>
              )}
            </div>
            <div className="mt-4 border-t border-line pt-4">
              <h3 className="mb-2 text-[10px] tracking-[0.25em] text-faint uppercase">reportar</h3>
              <ReportForm defaultUrl={site.url} />
            </div>
          </section>

          {/* espejos */}
          <section className="card-panel p-5">
            <h2 className="mb-3 text-[10px] tracking-[0.25em] text-faint uppercase">
              espejos detectados · {mirrors.length}
            </h2>
            {mirrors.length === 0 ? (
              <p className="py-4 text-center text-xs text-faint">
                ningún otro host sirve este mismo fingerprint
              </p>
            ) : (
              <ul className="space-y-1.5 font-mono text-[11px]">
                {mirrors.map((m) => (
                  <li key={m.id}>
                    <Link
                      href={`/sitio/${m.domain}`}
                      className="flex items-center gap-2 rounded border border-line/60 bg-void/60 px-3 py-2 transition-colors hover:border-line2"
                    >
                      <StatusDot status={m.status} />
                      <span className="truncate text-dim">{m.domain}</span>
                      <span className="ml-auto shrink-0 text-faint">{fmtPct(m.uptimeRatio)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

import { Suspense } from "react";
import Link from "next/link";
import { ArrowUpRight, Network, ShieldCheck, Layers, Activity } from "lucide-react";
import SearchClient from "@/components/search-client";
import { StatusDot } from "@/components/indicators";
import { ensureSeeded, runCrawlBatch, runHealthSweep } from "@/lib/crawler/pipeline";
import { getStats, getRecentSites } from "@/lib/search";
import { fmtNum, timeAgoEs } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Arranque en frío: si la base está vacía, sembrar y rastrear un primer lote. */
async function coldStart() {
  try {
    const seeded = await ensureSeeded();
    const stats = await getStats();
    if (seeded || (stats.pages === 0 && stats.queuePending > 0)) {
      await runCrawlBatch(14);
      await runHealthSweep(16);
    }
    return await getStats();
  } catch {
    return null;
  }
}

export default async function Home() {
  const [stats, recent] = await Promise.all([
    coldStart(),
    getRecentSites(6).catch(() => []),
  ]);

  return (
    <div className="pt-14 sm:pt-20">
      {/* HERO */}
      <section className="mx-auto max-w-3xl text-center">
        <div className="mb-5 flex items-center justify-center gap-2 text-[11px] tracking-[0.3em] text-faint uppercase">
          <span className="h-px w-8 bg-line2" />
          motor de búsqueda tor
          <span className="h-px w-8 bg-line2" />
        </div>
        <h1 className="glow font-display text-6xl font-bold tracking-[0.22em] text-ink sm:text-8xl">
          FARO
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-dim sm:text-base">
          Luz en la red oculta. Índice de servicios <span className="text-accent">.onion</span> con
          verificación de disponibilidad en tiempo real, deduplicación de espejos y blocklists.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[11px] text-faint">
          <span className="inline-flex items-center gap-1.5">
            <Network size={12} className="text-accent" /> rastreo vía SOCKS5
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Activity size={12} className="text-accent" /> health checker activo
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Layers size={12} className="text-accent" /> espejos agrupados
          </span>
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck size={12} className="text-accent" /> blocklist ética
          </span>
        </div>
      </section>

      {/* BUSCADOR */}
      <section className="mx-auto mt-10 max-w-3xl">
        <Suspense fallback={<div className="card-panel h-14 shimmer" />}>
          <SearchClient />
        </Suspense>
      </section>

      {/* STATS */}
      {stats && stats.pages > 0 && (
        <section className="mx-auto mt-16 max-w-4xl">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "páginas indexadas", value: fmtNum(stats.pages) },
              { label: "servicios en línea", value: fmtNum(stats.online) },
              { label: "verificaciones 24 h", value: fmtNum(stats.checks24h) },
              { label: "espejos agrupados", value: fmtNum(stats.mirrors) },
            ].map((c) => (
              <div key={c.label} className="card-panel px-4 py-3.5 text-center">
                <div className="font-display text-2xl font-bold tabular-nums text-accent glow-soft">
                  {c.value}
                </div>
                <div className="mt-1 text-[10px] tracking-wider text-faint uppercase">{c.label}</div>
              </div>
            ))}
          </div>
          {stats.lastCrawlAt && (
            <p className="mt-3 text-center text-[11px] text-faint">
              último rastreo exitoso: {timeAgoEs(stats.lastCrawlAt)}
            </p>
          )}
        </section>
      )}

      {/* NODOS RECIENTES */}
      {recent.length > 0 && (
        <section className="mx-auto mt-14 max-w-4xl">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xs tracking-[0.25em] text-dim uppercase">
              nodos recientemente rastreados
            </h2>
            <Link
              href="/ops"
              className="inline-flex items-center gap-1 text-[11px] text-faint uppercase transition-colors hover:text-accent"
            >
              panel de ops <ArrowUpRight size={12} />
            </Link>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {recent.map((s) => (
              <Link
                key={s.domain}
                href={`/sitio/${encodeURIComponent(s.domain)}`}
                className="rise card-panel flex items-center gap-3 px-4 py-3"
              >
                <StatusDot status={s.status} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-ink">{s.title}</div>
                  <div className="truncate font-mono text-[10px] text-faint">{s.domain}</div>
                </div>
                <span className="shrink-0 text-[10px] text-faint">
                  {timeAgoEs(s.lastCheckedAt)}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* NOTA AL PIE */}
      <footer className="mx-auto mt-20 max-w-2xl text-center text-[11px] leading-relaxed text-faint">
        <p>
          FARO no aloja contenido ni garantiza la seguridad de los servicios enlazados. El índice
          excluye automáticamente dominios y contenido en blocklist; los reportes de usuarios se
          procesan desde el panel de operaciones.
        </p>
      </footer>
    </div>
  );
}

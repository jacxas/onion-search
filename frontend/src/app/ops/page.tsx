import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { blocklist, crawlEvents, crawlQueue, healthChecks, onionSites, reports } from "@/db/schema";
import { getStats, getChecksSeries } from "@/lib/search";
import { ensureSeeded } from "@/lib/crawler/pipeline";
import { fmtNum, timeAgoEs, fmtMs, shortOnion } from "@/lib/format";
import { StatusDot } from "@/components/indicators";
import { requireAdmin } from "@/lib/auth";
import { logoutAction } from "@/app/login/actions";
import { LogOut, UserCog } from "lucide-react";
import {
  RunControls,
  RefreshLoop,
  SeedForm,
  AddBlockForm,
  RemoveBlockBtn,
  ChangePasswordForm,
} from "@/components/ops-client";
import {
  Database,
  Globe,
  CircleCheck,
  CircleOff,
  Ban,
  Layers,
  ListTree,
  HeartPulse,
  Flag,
  ServerCrash,
} from "lucide-react";

export const dynamic = "force-dynamic";

const EVENT_COLORS: Record<string, string> = {
  crawl: "text-cyan",
  health: "text-amber",
  discover: "text-accent",
  block: "text-red",
  seed: "text-accent",
  system: "text-dim",
};

export default async function OpsPage() {
  const session = await requireAdmin();
  await ensureSeeded().catch(() => false);

  const [stats, series, queueItems, events, blockRows, reportRows, recentChecks] =
    await Promise.all([
      getStats().catch(() => null),
      getChecksSeries().catch(() => []),
      db.select().from(crawlQueue).where(eq(crawlQueue.status, "pending")).orderBy(desc(crawlQueue.priority), crawlQueue.id).limit(15).catch(() => []),
      db.select().from(crawlEvents).orderBy(desc(crawlEvents.id)).limit(45).catch(() => []),
      db.select().from(blocklist).orderBy(desc(blocklist.id)).limit(30).catch(() => []),
      db.select().from(reports).where(eq(reports.status, "open")).orderBy(desc(reports.id)).limit(10).catch(() => []),
      db
        .select({
          checkedAt: healthChecks.checkedAt,
          online: healthChecks.online,
          responseMs: healthChecks.responseMs,
          httpStatus: healthChecks.httpStatus,
          domain: onionSites.domain,
        })
        .from(healthChecks)
        .leftJoin(onionSites, eq(healthChecks.siteId, onionSites.id))
        .orderBy(desc(healthChecks.id))
        .limit(12)
        .catch(() => []),
    ]);

  const maxBucket = Math.max(1, ...series.map((b) => b.online + b.offline));

  return (
    <div className="pt-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] tracking-[0.3em] text-faint uppercase">centro de mando</p>
          <h1 className="glow-soft font-display mt-1 text-3xl font-bold text-ink sm:text-4xl">
            Panel de operaciones
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded border border-line2 bg-panel2 px-2.5 py-1.5 text-[10px] text-dim">
            <UserCog size={11} className="text-accent" />
            {session.email}
          </span>
          <RefreshLoop seconds={12} />
          <form action={logoutAction}>
            <button className="btn !px-2 !py-1.5" title="cerrar sesión">
              <LogOut size={12} />
            </button>
          </form>
        </div>
      </header>

      {/* KPIs */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {[
          { icon: Database, label: "páginas indexadas", value: stats?.pages ?? 0, tone: "text-ink" },
          { icon: Globe, label: "servicios vistos", value: stats?.sites ?? 0, tone: "text-ink" },
          { icon: CircleCheck, label: "en línea", value: stats?.online ?? 0, tone: "text-accent" },
          { icon: CircleOff, label: "caídos", value: stats?.offline ?? 0, tone: "text-amber" },
          { icon: Ban, label: "bloqueados", value: stats?.blocked ?? 0, tone: "text-red" },
          { icon: Layers, label: "espejos", value: stats?.mirrors ?? 0, tone: "text-ink" },
          { icon: ListTree, label: "cola pendiente", value: stats?.queuePending ?? 0, tone: "text-cyan" },
          { icon: ServerCrash, label: "fallidos/bloq.", value: stats?.queueFailed ?? 0, tone: "text-amber" },
          { icon: HeartPulse, label: "checks 24 h", value: stats?.checks24h ?? 0, tone: "text-accent" },
          { icon: Flag, label: "reportes abiertos", value: stats?.reportsOpen ?? 0, tone: "text-red" },
        ].map((c) => (
          <div key={c.label} className="card-panel px-4 py-3.5">
            <div className="flex items-center gap-2 text-faint">
              <c.icon size={13} />
              <span className="text-[10px] tracking-wider uppercase">{c.label}</span>
            </div>
            <div className={`mt-1.5 font-display text-2xl font-bold tabular-nums ${c.tone}`}>
              {fmtNum(c.value)}
            </div>
          </div>
        ))}
      </section>

      {/* gráfico 24h + controles */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_360px]">
        <section className="card-panel p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[10px] tracking-[0.25em] text-faint uppercase">
              verificaciones por hora · 24 h
            </h2>
            <span className="flex items-center gap-3 text-[10px] text-faint">
              <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-accent/70" /> ok</span>
              <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-red/70" /> fallo</span>
            </span>
          </div>
          {series.length === 0 ? (
            <p className="py-10 text-center text-xs text-faint">
              sin datos todavía — ejecutá el pipeline para poblar la serie.
            </p>
          ) : (
            <div className="flex h-36 items-end gap-1.5">
              {series.map((b) => {
                const total = b.online + b.offline;
                const hOk = (b.online / maxBucket) * 100;
                const hBad = (b.offline / maxBucket) * 100;
                return (
                  <div
                    key={b.hour}
                    className="group flex flex-1 flex-col justify-end gap-0.5"
                    title={`${b.hour} — ${total} checks (${b.online} ok / ${b.offline} fallos)`}
                  >
                    <div className="w-full rounded-sm bg-red/60 transition-all group-hover:bg-red" style={{ height: `${Math.max(hBad, b.offline ? 3 : 0)}%` }} />
                    <div className="w-full rounded-sm bg-accent/60 transition-all group-hover:bg-accent" style={{ height: `${Math.max(hOk, b.online ? 3 : 0)}%` }} />
                  </div>
                );
              })}
            </div>
          )}
        </section>
        <RunControls />
      </div>

      {/* cola + actividad */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="card-panel p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[10px] tracking-[0.25em] text-faint uppercase">cola de rastreo</h2>
            <span className="text-[10px] text-faint">{stats?.queuePending ?? 0} pendientes</span>
          </div>
          {queueItems.length === 0 ? (
            <p className="py-8 text-center text-xs text-faint">cola vacía</p>
          ) : (
            <ul className="space-y-1.5 font-mono text-[11px]">
              {queueItems.map((it) => (
                <li key={it.id} className="flex items-center gap-3 rounded border border-line/60 bg-void/60 px-3 py-2">
                  <span className="shrink-0 rounded bg-panel2 px-1.5 py-0.5 text-[9px] text-cyan">d{it.depth}</span>
                  <span className="truncate text-dim">{shortOnion(it.url, 34)}</span>
                  <span className="ml-auto shrink-0 text-faint">
                    {it.attempts > 0 ? `${it.attempts} reint.` : timeAgoEs(it.createdAt.toISOString())}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 border-t border-line pt-4">
            <h3 className="mb-2 text-[10px] tracking-[0.25em] text-faint uppercase">agregar semilla</h3>
            <SeedForm />
          </div>
        </section>

        <section className="card-panel p-4 sm:p-5">
          <h2 className="mb-3 text-[10px] tracking-[0.25em] text-faint uppercase">actividad reciente</h2>
          {events.length === 0 ? (
            <p className="py-8 text-center text-xs text-faint">sin eventos</p>
          ) : (
            <ul className="max-h-[420px] space-y-1 overflow-y-auto pr-1 font-mono text-[11px] leading-relaxed">
              {events.map((ev) => (
                <li key={ev.id} className="flex gap-2">
                  <span className="shrink-0 text-faint">
                    {new Date(ev.createdAt).toLocaleTimeString("es-AR", { hour12: false })}
                  </span>
                  <span className={`shrink-0 ${EVENT_COLORS[ev.type] ?? "text-dim"}`}>
                    [{ev.type}]
                  </span>
                  <span className="text-dim">{ev.message}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* blocklist + últimos checks + reportes */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="card-panel p-4 sm:p-5">
          <h2 className="mb-3 text-[10px] tracking-[0.25em] text-faint uppercase">blocklist</h2>
          <AddBlockForm />
          {blockRows.length > 0 && (
            <ul className="mt-4 space-y-1.5 font-mono text-[11px]">
              {blockRows.map((b) => (
                <li key={b.id} className="flex items-center gap-3 rounded border border-line/60 bg-void/60 px-3 py-2">
                  <span className="shrink-0 rounded bg-panel2 px-1.5 py-0.5 text-[9px] text-red">{b.type}</span>
                  <span className="truncate text-dim">{b.value}</span>
                  {b.reason && <span className="hidden truncate text-faint sm:inline">· {b.reason}</span>}
                  <span className="ml-auto shrink-0"><RemoveBlockBtn id={b.id} /></span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="space-y-4">
          <section className="card-panel p-4 sm:p-5">
            <h2 className="mb-3 text-[10px] tracking-[0.25em] text-faint uppercase">últimos health checks</h2>
            {recentChecks.length === 0 ? (
              <p className="py-6 text-center text-xs text-faint">sin verificaciones aún</p>
            ) : (
              <ul className="space-y-1.5 font-mono text-[11px]">
                {recentChecks.map((c, i) => (
                  <li key={i} className="flex items-center gap-3 rounded border border-line/60 bg-void/60 px-3 py-2">
                    <StatusDot status={c.online ? "online" : "offline"} />
                    <span className="truncate text-dim">{shortOnion(c.domain ?? "—", 22)}</span>
                    <span className="shrink-0 text-faint">{c.httpStatus ?? "∅"}</span>
                    <span className="ml-auto shrink-0 text-faint">{fmtMs(c.responseMs)}</span>
                    <span className="shrink-0 text-faint">{timeAgoEs(c.checkedAt.toISOString())}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card-panel p-4 sm:p-5">
            <h2 className="mb-3 text-[10px] tracking-[0.25em] text-faint uppercase">seguridad · cambiar contraseña</h2>
            <ChangePasswordForm />
          </section>

          <section className="card-panel p-4 sm:p-5">
            <h2 className="mb-3 text-[10px] tracking-[0.25em] text-faint uppercase">reportes abiertos</h2>
            {reportRows.length === 0 ? (
              <p className="py-6 text-center text-xs text-faint">sin reportes</p>
            ) : (
              <ul className="space-y-1.5 font-mono text-[11px]">
                {reportRows.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 rounded border border-line/60 bg-void/60 px-3 py-2">
                    <span className="shrink-0 rounded bg-panel2 px-1.5 py-0.5 text-[9px] text-amber">{r.reason}</span>
                    <span className="truncate text-dim">{r.url}</span>
                    <span className="ml-auto shrink-0 text-faint">{timeAgoEs(r.createdAt.toISOString())}</span>
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

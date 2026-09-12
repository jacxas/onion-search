import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { getStats } from "@/lib/search";
import { getSessionUser } from "@/lib/auth";
import { getTransport } from "@/lib/tor/transport";
import {
  logoutAction, runCrawlAction, runHealthAction, addSeedAction,
  blockDomainAction, unblockDomainAction, resolveReportAction, changePasswordAction,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function OpsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const transport = getTransport();
  const stats = await getStats();

  const [queueRes, sitesRes, reportsRes, blockRes] = await Promise.all([
    db().execute(sql`SELECT status, count(*)::int AS n FROM crawl_queue GROUP BY status ORDER BY status`),
    db().execute(sql`
      SELECT domain, title, online, blocked, uptime_ratio AS "uptimeRatio",
             total_checks AS "totalChecks", last_checked_at AS "lastCheckedAt"
      FROM sites ORDER BY uptime_ratio DESC, domain LIMIT 40`),
    db().execute(sql`
      SELECT id, url, reason, status, created_at AS "createdAt" FROM reports
      ORDER BY status, created_at DESC LIMIT 25`),
    db().execute(sql`SELECT pattern, reason, added_at AS "addedAt" FROM blocklist ORDER BY added_at DESC LIMIT 25`),
  ]);

  const fmtDate = (v: unknown) =>
    v ? new Date(String(v)).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }) : "—";

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-widest text-green-400">FARO · ops</h1>
        <div className="flex items-center gap-3 text-xs text-neutral-500">
          <span>{user.email} · modo {transport.name}</span>
          <form action={logoutAction}><button className="underline">salir</button></form>
        </div>
      </header>

      {/* ── stats ── */}
      <section className="mb-6 grid grid-cols-3 gap-3 md:grid-cols-6">
        {[
          ["sitios", stats.sites], ["en línea", stats.online], ["bloqueados", stats.blocked],
          ["páginas", stats.pages], ["pendientes", stats.pendingQueue], ["grupos espejo", stats.mirrors],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded border border-neutral-800 bg-neutral-950 p-3 text-center">
            <div className="text-2xl font-bold text-green-400">{String(value)}</div>
            <div className="text-xs text-neutral-500">{String(label)}</div>
          </div>
        ))}
      </section>

      {/* ── acciones ── */}
      <section className="mb-8 grid gap-4 md:grid-cols-2">
        <div className="rounded border border-neutral-800 bg-neutral-950 p-4">
          <h2 className="mb-3 text-sm font-semibold text-neutral-300">pipeline</h2>
          <div className="flex flex-wrap items-center gap-2">
            <form action={runCrawlAction} className="flex items-center gap-2">
              <input name="maxPages" type="number" min={1} max={200} defaultValue={30}
                className="w-20 rounded border border-neutral-800 bg-black px-2 py-1 text-sm" />
              <button className="rounded border border-green-800 bg-green-900/30 px-3 py-1 text-sm text-green-400 hover:bg-green-900/50">
                rastrear
              </button>
            </form>
            <form action={runHealthAction}>
              <button className="rounded border border-blue-900 bg-blue-900/30 px-3 py-1 text-sm text-blue-300 hover:bg-blue-900/50">
                health sweep
              </button>
            </form>
          </div>
          <p className="mt-2 text-xs text-neutral-600">último crawl: {fmtDate(stats.lastCrawlAt)}</p>
        </div>

        <div className="rounded border border-neutral-800 bg-neutral-950 p-4">
          <h2 className="mb-3 text-sm font-semibold text-neutral-300">semillas</h2>
          <form action={addSeedAction} className="flex gap-2">
            <input name="seeds" placeholder="http://xxx.onion/, http://yyy.onion/"
              className="flex-1 rounded border border-neutral-800 bg-black px-2 py-1 text-sm" />
            <button className="rounded border border-neutral-700 px-3 py-1 text-sm text-neutral-300 hover:bg-neutral-800">
              encolar
            </button>
          </form>
        </div>
      </section>

      {/* ── cola ── */}
      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold text-neutral-300">cola de rastreo</h2>
        <div className="rounded border border-neutral-800 bg-neutral-950 p-3 text-xs">
          {(queueRes.rows as Record<string, unknown>[]).map((r) => (
            <span key={String(r.status)} className="mr-4">
              {String(r.status)}: <span className="text-green-400">{String(r.n)}</span>
            </span>
          ))}
          {(queueRes.rows as Record<string, unknown>[]).length === 0 && <span className="text-neutral-600">vacía</span>}
        </div>
      </section>

      {/* ── sitios ── */}
      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold text-neutral-300">sitios (top 40)</h2>
        <div className="overflow-x-auto rounded border border-neutral-800 bg-neutral-950">
          <table className="w-full text-xs">
            <thead className="text-neutral-500">
              <tr><th className="p-2 text-left">dominio</th><th className="p-2 text-left">título</th><th className="p-2">estado</th>
                  <th className="p-2">uptime</th><th className="p-2">últ. check</th><th className="p-2">acción</th></tr>
            </thead>
            <tbody>
              {(sitesRes.rows as Record<string, unknown>[]).map((s) => (
                <tr key={String(s.domain)} className="border-t border-neutral-900">
                  <td className="p-2"><Link href={`/sitio/${s.domain}`} className="underline">{String(s.domain)}</Link></td>
                  <td className="max-w-48 truncate p-2 text-neutral-400">{String(s.title ?? "")}</td>
                  <td className="p-2 text-center">
                    {s.blocked ? <span className="text-red-500">bloq</span>
                      : s.online ? <span className="text-green-500">on</span>
                      : <span className="text-neutral-500">off</span>}
                  </td>
                  <td className="p-2 text-center text-neutral-400">{(Number(s.uptimeRatio ?? 0) * 100).toFixed(0)}%</td>
                  <td className="p-2 text-center text-neutral-500">{fmtDate(s.lastCheckedAt)}</td>
                  <td className="p-2 text-center">
                    {s.blocked ? (
                      <form action={unblockDomainAction}>
                        <input type="hidden" name="domain" value={String(s.domain)} />
                        <button className="underline">desbloquear</button>
                      </form>
                    ) : (
                      <form action={blockDomainAction}>
                        <input type="hidden" name="domain" value={String(s.domain)} />
                        <input type="hidden" name="reason" value="manual-ops" />
                        <button className="text-red-400 underline">bloquear</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── reportes + blocklist ── */}
      <section className="grid gap-4 md:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-semibold text-neutral-300">reportes</h2>
          <ul className="space-y-1 rounded border border-neutral-800 bg-neutral-950 p-3 text-xs">
            {(reportsRes.rows as Record<string, unknown>[]).map((r) => (
              <li key={String(r.id)} className="flex items-center justify-between gap-2 border-b border-neutral-900 pb-1">
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-neutral-500">[{String(r.status)}]</span> {String(r.url)} ({String(r.reason)})
                </span>
                {r.status !== "dismissed" && (
                  <form action={resolveReportAction} className="flex gap-2">
                    <input type="hidden" name="id" value={String(r.id)} />
                    <button name="status" value="reviewed" className="underline">ok</button>
                    <button name="status" value="dismissed" className="text-neutral-500 underline">desc</button>
                  </form>
                )}
              </li>
            ))}
            {(reportsRes.rows as Record<string, unknown>[]).length === 0 && <li className="text-neutral-600">sin reportes</li>}
          </ul>
        </div>
        <div>
          <h2 className="mb-2 text-sm font-semibold text-neutral-300">blocklist</h2>
          <ul className="mb-2 space-y-1 rounded border border-neutral-800 bg-neutral-950 p-3 text-xs">
            {(blockRes.rows as Record<string, unknown>[]).map((b) => (
              <li key={String(b.pattern)} className="flex items-center justify-between border-b border-neutral-900 pb-1">
                <span className="min-w-0 flex-1 truncate">{String(b.pattern)} <span className="text-neutral-600">({String(b.reason)})</span></span>
                <form action={unblockDomainAction}>
                  <input type="hidden" name="domain" value={String(b.pattern)} />
                  <button className="text-red-400 underline">quitar</button>
                </form>
              </li>
            ))}
            {(blockRes.rows as Record<string, unknown>[]).length === 0 && <li className="text-neutral-600">vacía</li>}
          </ul>
          <form action={blockDomainAction} className="flex gap-2">
            <input name="domain" placeholder="dominio.onion" className="flex-1 rounded border border-neutral-800 bg-black px-2 py-1 text-sm" />
            <input name="reason" placeholder="razón" className="w-24 rounded border border-neutral-800 bg-black px-2 py-1 text-sm" />
            <button className="rounded border border-red-900 bg-red-950/40 px-3 py-1 text-sm text-red-400 hover:bg-red-950/60">bloquear</button>
          </form>
        </div>
      </section>

      {/* ── cuenta ── */}
      <section className="mt-8">
        <h2 className="mb-2 text-sm font-semibold text-neutral-300">cuenta</h2>
        <form action={changePasswordAction} className="flex gap-2">
          <input name="newPassword" type="password" placeholder="clave nueva (mín. 8)" minLength={8}
            className="rounded border border-neutral-800 bg-black px-2 py-1 text-sm" />
          <button className="rounded border border-neutral-700 px-3 py-1 text-sm text-neutral-300 hover:bg-neutral-800">cambiar clave</button>
        </form>
        <p className="mt-1 text-xs text-neutral-600">cambiar la clave invalida todas las sesiones</p>
      </section>
    </main>
  );
}

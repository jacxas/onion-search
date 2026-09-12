import Link from "next/link";
import { notFound } from "next/navigation";
import { getDomainDetail } from "@/lib/search";
import { getSessionUser } from "@/lib/auth";
import { blockDomainAction, unblockDomainAction } from "@/app/ops/actions";

export const dynamic = "force-dynamic";

export default async function SitePage({ params }: { params: Promise<{ domain: string }> }) {
  const { domain } = await params;
  const detail = await getDomainDetail(domain);
  if (!detail) notFound();
  const admin = await getSessionUser();
  const s = detail.site;

  const fmtDate = (v: unknown) =>
    v ? new Date(String(v)).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }) : "—";
  const pct = (n: unknown) => `${(Number(n ?? 0) * 100).toFixed(0)}%`;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-4 flex items-center justify-between">
        <Link href="/" className="text-xs underline">← FARO</Link>
        {admin && (
          s.blocked ? (
            <form action={unblockDomainAction}>
              <input type="hidden" name="domain" value={String(s.domain)} />
              <button className="text-xs underline">desbloquear</button>
            </form>
          ) : (
            <form action={blockDomainAction}>
              <input type="hidden" name="domain" value={String(s.domain)} />
              <input type="hidden" name="reason" value="manual-sitio" />
              <button className="text-xs text-red-400 underline">bloquear</button>
            </form>
          )
        )}
      </div>

      <h1 className="break-all text-xl font-bold text-green-400">{String(s.title) || String(s.domain)}</h1>
      <p className="mt-1 break-all text-sm text-neutral-500">{String(s.url)}</p>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded border border-neutral-800 bg-neutral-950 p-3 text-center">
          <div className={`text-lg font-bold ${s.blocked ? "text-red-500" : s.online ? "text-green-400" : "text-neutral-500"}`}>
            {s.blocked ? "bloqueado" : s.online ? "en línea" : "caído"}
          </div>
          <div className="text-xs text-neutral-600">estado</div>
        </div>
        <div className="rounded border border-neutral-800 bg-neutral-950 p-3 text-center">
          <div className="text-lg font-bold text-green-400">{pct(s.uptimeRatio)}</div>
          <div className="text-xs text-neutral-600">uptime ({String(s.successfulChecks)}/{String(s.totalChecks)})</div>
        </div>
        <div className="rounded border border-neutral-800 bg-neutral-950 p-3 text-center">
          <div className="text-lg font-bold text-green-400">{s.avgResponseMs ? `${String(s.avgResponseMs)}ms` : "—"}</div>
          <div className="text-xs text-neutral-600">latencia media</div>
        </div>
        <div className="rounded border border-neutral-800 bg-neutral-950 p-3 text-center">
          <div className="text-lg font-bold">{String(s.statusCode || "—")}</div>
          <div className="text-xs text-neutral-600">último status</div>
        </div>
      </div>

      {Boolean(s.blocked) && (
        <p className="mt-3 rounded border border-red-900 bg-red-950/30 p-2 text-sm text-red-400">
          bloqueado: {String(s.blockReason ?? "sin razón")}
        </p>
      )}
      {s.description ? <p className="mt-3 text-sm text-neutral-400">{String(s.description)}</p> : null}

      <div className="mt-3 text-xs text-neutral-600">
        descubierto {fmtDate(s.discoveredAt)} · último crawl {fmtDate(s.lastCrawledAt)} · último online {fmtDate(s.lastOnlineAt)}
      </div>

      {detail.mirrors.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold text-amber-500">espejos ({detail.mirrors.length})</h2>
          <ul className="rounded border border-neutral-800 bg-neutral-950 p-3 text-xs">
            {detail.mirrors.map((m) => (
              <li key={String(m.domain)} className="flex items-center justify-between border-b border-neutral-900 py-1">
                <Link href={`/sitio/${m.domain}`} className="underline">{String(m.domain)}</Link>
                <span className={m.online ? "text-green-500" : "text-neutral-500"}>{pct(m.uptimeRatio)} · {m.online ? "on" : "off"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8">
        <h2 className="mb-2 text-sm font-semibold text-neutral-300">páginas ({detail.pages.length})</h2>
        <ul className="space-y-1 rounded border border-neutral-800 bg-neutral-950 p-3 text-xs">
          {detail.pages.map((p) => (
            <li key={String(p.id)} className="border-b border-neutral-900 py-1">
              <a href={String(p.url)} className="underline">{String(p.title) || String(p.path)}</a>
              <span className="ml-2 text-neutral-600">depth {String(p.depth)} · {fmtDate(p.crawledAt)}</span>
            </li>
          ))}
          {detail.pages.length === 0 && <li className="text-neutral-600">sin páginas indexadas</li>}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="mb-2 text-sm font-semibold text-neutral-300">historial de salud (últimos {detail.health.length})</h2>
        <div className="max-h-72 overflow-y-auto rounded border border-neutral-800 bg-neutral-950">
          <table className="w-full text-xs">
            <thead className="text-neutral-500">
              <tr><th className="p-2 text-left">cuándo</th><th className="p-2">status</th><th className="p-2">ms</th><th className="p-2 text-left">error</th></tr>
            </thead>
            <tbody>
              {detail.health.map((h, i) => (
                <tr key={i} className="border-t border-neutral-900">
                  <td className="p-2">{fmtDate(h.checkedAt)}</td>
                  <td className={`p-2 text-center ${h.online ? "text-green-500" : "text-red-500"}`}>{String(h.statusCode || "0")}</td>
                  <td className="p-2 text-center text-neutral-400">{h.responseMs ? String(h.responseMs) : "—"}</td>
                  <td className="p-2 text-neutral-600">{String(h.error ?? "")}</td>
                </tr>
              ))}
              {detail.health.length === 0 && (
                <tr><td colSpan={4} className="p-2 text-center text-neutral-600">sin checks todavía</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

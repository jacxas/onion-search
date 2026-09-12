import Link from "next/link";
import { searchPages, getStats } from "@/lib/search";

export const dynamic = "force-dynamic";

interface SearchPageProps {
  searchParams: Promise<{ q?: string; online?: string }>;
}

export default async function Home({ searchParams }: SearchPageProps) {
  const { q = "", online } = await searchParams;
  const onlineOnly = online === "1";
  const stats = await getStats();

  // SEC-03: la página pública SOLO observa. El crawl/health los ejecuta el
  // worker (WORKER_INTERVAL_SECONDS) o una acción administrativa explícita.

  const hits = q.trim() ? await searchPages(q, { onlineOnly, limit: 25 }) : [];

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-8 text-center">
        <h1 className="text-4xl font-bold tracking-widest text-green-400">F A R O</h1>
        <p className="mt-2 text-sm text-neutral-500">
          buscador .onion · {stats.sites} sitios · {stats.online} en línea · {stats.pages} páginas
        </p>
      </header>

      <form method="get" className="mb-6 flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="buscar en la red onion…"
          className="flex-1 rounded border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-green-700"
        />
        <label className="flex items-center gap-1 text-xs text-neutral-400">
          <input type="checkbox" name="online" value="1" defaultChecked={onlineOnly} /> solo en línea
        </label>
        <button type="submit" className="rounded border border-green-800 bg-green-900/30 px-4 py-2 text-sm text-green-400 hover:bg-green-900/50">
          buscar
        </button>
      </form>

      {q.trim() && hits.length === 0 && (
        <p className="text-sm text-neutral-500">sin resultados para «{q}».</p>
      )}

      <ul className="space-y-4">
        {hits.map((h) => (
          <li key={h.id} className="rounded border border-neutral-800 bg-neutral-950 p-4">
            <div className="flex items-baseline justify-between gap-2">
              <a href={h.url} className="text-base font-semibold" rel="noreferrer">
                {h.title || h.domain}
              </a>
              <span className={`text-xs ${h.online ? "text-green-500" : "text-red-500"}`}>
                {h.online ? "● en línea" : "○ caído"}
              </span>
            </div>
            <p className="mt-1 text-xs text-neutral-500">{h.description ?? h.url}</p>
            <div className="mt-2 flex items-center gap-3 text-xs text-neutral-600">
              <Link href={`/sitio/${h.domain}`} className="underline">{h.domain}</Link>
              <span>uptime {(h.uptimeRatio * 100).toFixed(0)}%</span>
              {h.mirrorGroupId !== null && <span className="text-amber-600">espejo</span>}
            </div>
          </li>
        ))}
      </ul>

      <footer className="mt-10 text-center text-xs text-neutral-700">
        <Link href="/ops" className="underline">ops</Link>
      </footer>
    </main>
  );
}

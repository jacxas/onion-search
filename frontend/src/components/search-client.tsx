"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Copy,
  Layers,
  Clock3,
  Gauge,
  ShieldCheck,
  Fingerprint,
  CornerDownRight,
  Loader2,
} from "lucide-react";
import { StatusDot, UptimeBar } from "@/components/indicators";
import { fmtMs, shortOnion, timeAgoEs, fmtNum } from "@/lib/format";

interface Result {
  pageId: number;
  url: string;
  title: string;
  description: string;
  crawledAt: string;
  domain: string;
  status: string;
  uptimeRatio: number;
  avgResponseMs: number | null;
  lastCheckedAt: string | null;
  mirrors: number;
}

interface ApiResponse {
  results: Result[];
  total: number;
  tookMs: number;
  page: number;
  pages: number;
  q: string;
}

const SUGGESTIONS = ["privacidad", "wiki", "correo", "biblioteca", "foro", "cripto", "osint", "noticias"];

export default function SearchClient() {
  const router = useRouter();
  const params = useSearchParams();
  const initialQ = params.get("q") ?? "";

  const [q, setQ] = useState(initialQ);
  const [onlineOnly, setOnlineOnly] = useState(params.get("online") === "1");
  const [uptime80, setUptime80] = useState(params.get("uptime80") === "1");
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const runSearch = useCallback(
    async (query: string, page = 1, opts?: { online?: boolean; up80?: boolean }) => {
      const onl = opts?.online ?? onlineOnly;
      const up = opts?.up80 ?? uptime80;
      if (!query.trim()) {
        setData(null);
        setSearched(false);
        return;
      }
      setLoading(true);
      setSearched(true);
      try {
        const u = new URLSearchParams({ q: query.trim(), page: String(page) });
        if (onl) u.set("online", "1");
        if (up) u.set("uptime80", "1");
        const res = await fetch(`/api/search?${u.toString()}`, { cache: "no-store" });
        const json = (await res.json()) as ApiResponse;
        setData(json);
        const qs = new URLSearchParams({ q: query.trim() });
        if (page > 1) qs.set("page", String(page));
        if (onl) qs.set("online", "1");
        if (up) qs.set("uptime80", "1");
        router.replace(`/?${qs.toString()}`, { scroll: false });
      } catch {
        setData({ results: [], total: 0, tookMs: 0, page: 1, pages: 1, q: query });
      } finally {
        setLoading(false);
      }
    },
    [onlineOnly, uptime80, router],
  );

  // consulta inicial desde la URL (diferido: evita setState síncrono en efecto)
  useEffect(() => {
    if (!initialQ) return;
    const t = setTimeout(() => {
      void runSearch(initialQ, Number(params.get("page") ?? 1));
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ctrl+k enfoca
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const toggleFilter = (which: "online" | "up80") => {
    const next = which === "online" ? !onlineOnly : !uptime80;
    if (which === "online") setOnlineOnly(next);
    else setUptime80(next);
    if (q.trim()) {
      runSearch(q, 1, {
        online: which === "online" ? next : onlineOnly,
        up80: which === "up80" ? next : uptime80,
      });
    }
  };

  return (
    <div className="w-full">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          runSearch(q, 1);
        }}
        className="hero-input flex items-center gap-3 rounded-xl border border-line2 bg-panel px-4 py-3.5 transition-all sm:px-5"
      >
        <Search size={18} className="shrink-0 text-accent" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar en servicios ocultos…"
          className="w-full bg-transparent font-mono text-base text-ink outline-none placeholder:text-faint sm:text-lg"
          autoComplete="off"
          spellCheck={false}
        />
        <kbd className="hidden shrink-0 rounded border border-line bg-panel2 px-2 py-1 text-[10px] text-faint sm:block">
          CTRL K
        </kbd>
        <button type="submit" className="btn btn-primary shrink-0" disabled={loading}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : null}
          Buscar
        </button>
      </form>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-[11px] tracking-wider text-faint uppercase">filtros</span>
        <button type="button" className="chip" aria-pressed={onlineOnly} onClick={() => toggleFilter("online")}>
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${onlineOnly ? "bg-accent" : "bg-line2"}`} />
          solo en línea
        </button>
        <button type="button" className="chip" aria-pressed={uptime80} onClick={() => toggleFilter("up80")}>
          <Gauge size={12} />
          disponibilidad ≥ 80%
        </button>
        {!searched && (
          <span className="ml-1 hidden items-center gap-2 sm:flex">
            <span className="text-[11px] tracking-wider text-faint uppercase">probar</span>
            {SUGGESTIONS.slice(0, 5).map((s) => (
              <button key={s} type="button" className="chip" onClick={() => { setQ(s); runSearch(s, 1); }}>
                {s}
              </button>
            ))}
          </span>
        )}
      </div>

      {/* meta de resultados */}
      {searched && data && (
        <div className="rise mt-8 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line pb-3 text-xs text-dim">
          <span className="text-ink">
            {fmtNum(data.total)} resultado{data.total === 1 ? "" : "s"}
          </span>
          <span>para «{data.q}»</span>
          <span>· {data.tookMs} ms</span>
          <span className="ml-auto inline-flex items-center gap-1.5 text-faint">
            <ShieldCheck size={12} className="text-accent" />
            solo sitios no bloqueados, espejos agrupados
          </span>
        </div>
      )}

      {/* skeleton */}
      {loading && (
        <div className="mt-6 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="card-panel p-4">
              <div className="shimmer h-4 w-2/5 rounded" />
              <div className="shimmer mt-3 h-3 w-full rounded" />
              <div className="shimmer mt-2 h-3 w-3/5 rounded" />
            </div>
          ))}
        </div>
      )}

      {/* resultados */}
      {!loading && data && data.results.length > 0 && (
        <ol className="mt-6 space-y-3">
          {data.results.map((r, i) => (
            <li key={r.pageId} className="rise card-panel group p-4 sm:p-5" style={{ animationDelay: `${Math.min(i * 35, 350)}ms` }}>
              <div className="flex items-start gap-3">
                <StatusDot status={r.status} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="glow-soft truncate font-display text-base font-semibold text-accent underline-offset-4 hover:underline sm:text-lg"
                    >
                      {r.title}
                    </a>
                    {r.mirrors > 0 && (
                      <span className="inline-flex items-center gap-1 rounded border border-line2 px-1.5 py-0.5 text-[10px] text-amber">
                        <Layers size={10} />
                        {r.mirrors} espejo{r.mirrors === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>

                  {r.description && (
                    <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-dim">{r.description}</p>
                  )}

                  <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-faint">
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex max-w-full items-center gap-1.5 truncate font-mono text-dim transition-colors hover:text-cyan"
                    >
                      <Fingerprint size={11} className="shrink-0" />
                      <span className="truncate">{shortOnion(r.domain, 26)}</span>
                      <Copy size={10} className="opacity-0 transition-opacity group-hover:opacity-60" />
                    </a>
                    <span className="inline-flex items-center gap-1">
                      <Clock3 size={11} />
                      verificado {timeAgoEs(r.lastCheckedAt)}
                    </span>
                    <Link
                      href={`/sitio/${encodeURIComponent(r.domain)}`}
                      className="inline-flex items-center gap-1 text-dim transition-colors hover:text-accent"
                    >
                      <CornerDownRight size={11} />
                      ficha del nodo
                    </Link>
                  </div>
                </div>

                <div className="hidden shrink-0 flex-col items-end gap-1.5 text-right sm:flex">
                  <UptimeBar ratio={r.uptimeRatio} />
                  <span className="text-[11px] tabular-nums text-faint">
                    {fmtMs(r.avgResponseMs)} prom.
                  </span>
                  <span className="text-[10px] text-faint">
                    rastreado {timeAgoEs(r.crawledAt)}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      {/* vacío */}
      {!loading && searched && data && data.results.length === 0 && (
        <div className="rise card-panel mt-8 p-10 text-center">
          <p className="text-dim">
            Sin resultados para <span className="text-ink">«{data.q}»</span>.
          </p>
          <p className="mt-2 text-xs text-faint">
            Probá con términos más generales — el índice se expande con cada lote de rastreo.
          </p>
          <Link href="/ops" className="btn mt-6">
            abrir panel de operaciones
          </Link>
        </div>
      )}

      {/* paginación */}
      {!loading && data && data.pages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-4">
          <button
            className="btn"
            disabled={data.page <= 1}
            onClick={() => runSearch(data.q, data.page - 1)}
          >
            <ChevronLeft size={14} /> anterior
          </button>
          <span className="text-xs tabular-nums text-dim">
            {data.page} / {data.pages}
          </span>
          <button
            className="btn"
            disabled={data.page >= data.pages}
            onClick={() => runSearch(data.q, data.page + 1)}
          >
            siguiente <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

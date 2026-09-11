"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Play,
  HeartPulse,
  Sprout,
  Loader2,
  Plus,
  Trash2,
  RefreshCw,
} from "lucide-react";
import {
  addSeedAction,
  addBlockAction,
  removeBlockAction,
  reportUrlAction,
  changePasswordAction,
} from "@/app/actions";
import { KeyRound } from "lucide-react";

/* ── ejecutar pipeline ─────────────────────────────────────────── */

export function RunControls() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string | null>(null);

  async function run(kind: "pipeline" | "crawl" | "health" | "seed", limit = 12) {
    setBusy(kind);
    setLog(null);
    try {
      const res = await fetch("/api/admin/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, limit }),
      });
      const json = await res.json();
      if (kind === "health") {
        const h = json.health;
        setLog(`sweep listo: ${h.online}/${h.checked} en línea · avg ${h.avgMs}ms`);
      } else if (kind === "seed") {
        setLog(json.seeded ? "semillas encoladas" : "ya había trabajo en cola");
      } else {
        const c = json.crawl;
        const h = json.health;
        setLog(
          `lote: ${c.ok} OK / ${c.failed} fallos / ${c.discovered} enlaces nuevos` +
            (h ? ` · salud: ${h.online}/${h.checked} up` : ""),
        );
      }
      router.refresh();
    } catch (e) {
      setLog(`error: ${e instanceof Error ? e.message : "desconocido"}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card-panel p-4 sm:p-5">
      <div className="mb-3 text-[10px] tracking-[0.25em] text-faint uppercase">
        control del pipeline
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary" disabled={busy !== null} onClick={() => run("pipeline", 14)}>
          {busy === "pipeline" ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          pipeline completo
        </button>
        <button className="btn" disabled={busy !== null} onClick={() => run("crawl", 14)}>
          {busy === "crawl" ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          lote de rastreo
        </button>
        <button className="btn" disabled={busy !== null} onClick={() => run("health", 20)}>
          {busy === "health" ? <Loader2 size={14} className="animate-spin" /> : <HeartPulse size={14} />}
          health sweep
        </button>
        <button className="btn" disabled={busy !== null} onClick={() => run("seed")}>
          {busy === "seed" ? <Loader2 size={14} className="animate-spin" /> : <Sprout size={14} />}
          sembrar
        </button>
      </div>
      {log && (
        <p className="rise mt-3 rounded border border-line bg-void px-3 py-2 font-mono text-[11px] text-accent">
          &gt; {log}
        </p>
      )}
    </div>
  );
}

/* ── auto-refresh del panel ────────────────────────────────────── */

export function RefreshLoop({ seconds = 12 }: { seconds?: number }) {
  const router = useRouter();
  const [spinning, setSpinning] = useState(false);
  useEffect(() => {
    const id = setInterval(() => {
      setSpinning(true);
      router.refresh();
      setTimeout(() => setSpinning(false), 500);
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] text-faint uppercase">
      <RefreshCw size={11} className={spinning ? "animate-spin text-accent" : ""} />
      auto {seconds}s
    </span>
  );
}

/* ── agregar semilla ───────────────────────────────────────────── */

export function SeedForm() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState(true);

  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const r = await addSeedAction(fd);
          setOk(r.ok);
          setMsg(r.message);
          if (r.ok) (e.target as HTMLFormElement).reset();
        });
      }}
    >
      <input name="url" className="field" placeholder="http://xxxx….onion/" required />
      <button className="btn btn-primary" disabled={pending}>
        {pending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
        encolar
      </button>
      {msg && (
        <p className={`basis-full text-[11px] ${ok ? "text-accent" : "text-red"}`}>{msg}</p>
      )}
    </form>
  );
}

/* ── blocklist ─────────────────────────────────────────────────── */

export function AddBlockForm() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState(true);

  return (
    <form
      className="grid grid-cols-1 gap-2 sm:grid-cols-[130px_1fr_1fr_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form);
        start(async () => {
          const r = await addBlockAction(fd);
          setOk(r.ok);
          setMsg(r.message);
          if (r.ok) form.reset();
        });
      }}
    >
      <select name="type" className="field" defaultValue="domain">
        <option value="domain">dominio</option>
        <option value="hash">hash</option>
        <option value="keyword">keyword</option>
      </select>
      <input name="value" className="field" placeholder="valor a bloquear…" required />
      <input name="reason" className="field" placeholder="motivo (opcional)" />
      <button className="btn btn-primary" disabled={pending}>
        {pending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
        bloquear
      </button>
      {msg && (
        <p className={`text-[11px] sm:col-span-4 ${ok ? "text-accent" : "text-red"}`}>{msg}</p>
      )}
    </form>
  );
}

export function RemoveBlockBtn({ id }: { id: number }) {
  const [pending, start] = useTransition();
  return (
    <button
      className="btn !px-2 !py-1.5"
      disabled={pending}
      onClick={() => start(async () => { await removeBlockAction(id); })}
      title="quitar regla"
    >
      {pending ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
    </button>
  );
}

/* ── cambio de contraseña ──────────────────────────────────────── */

export function ChangePasswordForm() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState(true);

  return (
    <form
      className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form);
        start(async () => {
          const r = await changePasswordAction(fd);
          setOk(r.ok);
          setMsg(r.message);
          if (r.ok) form.reset();
        });
      }}
    >
      <input name="current" type="password" className="field" placeholder="contraseña actual" required />
      <input name="next" type="password" className="field" placeholder="nueva (mín. 8)" required />
      <button className="btn" disabled={pending}>
        {pending ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
        actualizar
      </button>
      {msg && (
        <p className={`text-[11px] sm:col-span-3 ${ok ? "text-accent" : "text-red"}`}>{msg}</p>
      )}
    </form>
  );
}

/* ── reportes ──────────────────────────────────────────────────── */

export function ReportForm({ defaultUrl = "" }: { defaultUrl?: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState(true);

  return (
    <form
      className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_150px_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form);
        start(async () => {
          const r = await reportUrlAction(fd);
          setOk(r.ok);
          setMsg(r.message);
          if (r.ok) form.reset();
        });
      }}
    >
      <input name="url" className="field" placeholder="URL a reportar…" defaultValue={defaultUrl} required />
      <select name="reason" className="field" defaultValue="spam">
        <option value="spam">spam</option>
        <option value="scam">estafa</option>
        <option value="ilegal">contenido ilegal</option>
        <option value="offline">caído</option>
        <option value="otro">otro</option>
      </select>
      <button className="btn" disabled={pending}>
        {pending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
        reportar
      </button>
      {msg && (
        <p className={`text-[11px] sm:col-span-3 ${ok ? "text-accent" : "text-red"}`}>{msg}</p>
      )}
    </form>
  );
}

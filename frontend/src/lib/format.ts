/** Formateadores de UI (puros, seguros para cliente). */

export function timeAgoEs(iso: string | null | undefined): string {
  if (!iso) return "nunca";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "nunca";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 45) return "ahora mismo";
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `hace ${d} d`;
  const mo = Math.floor(d / 30);
  return `hace ${mo} m`;
}

export function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function fmtPct(r: number | null | undefined): string {
  if (r == null) return "—";
  return `${Math.round(r * 100)}%`;
}

export function shortOnion(domain: string, keep = 18): string {
  if (domain.length <= keep + 6) return domain;
  return `${domain.slice(0, keep)}…${domain.slice(-6)}`;
}

export function fmtNum(n: number): string {
  return new Intl.NumberFormat("es-AR").format(n);
}

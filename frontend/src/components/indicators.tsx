/** Indicadores visuales puros — seguros para componentes cliente. */

export function StatusDot({ status }: { status: string }) {
  const cls =
    status === "online" ? "dot-online" : status === "offline" ? "dot-offline" : "dot-unknown";
  return (
    <span
      className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${cls}`}
      title={status}
    />
  );
}

export function UptimeBar({ ratio }: { ratio: number }) {
  const pct = Math.round(ratio * 100);
  const color =
    pct >= 80 ? "var(--color-accent)" : pct >= 45 ? "var(--color-amber)" : "var(--color-red)";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-1 w-14 overflow-hidden rounded-full bg-line">
        <span
          className="block h-full rounded-full"
          style={{ width: `${pct}%`, background: color }}
        />
      </span>
      <span className="text-[11px] tabular-nums" style={{ color }}>
        {pct}%
      </span>
    </span>
  );
}

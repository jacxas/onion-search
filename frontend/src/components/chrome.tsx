import Link from "next/link";
import { Radar, TerminalSquare, FlaskConical } from "lucide-react";
import { CRAWL_MODE } from "@/lib/tor/transport";

export function Logo({ size = 20 }: { size?: number }) {
  return (
    <span className="relative inline-flex items-center justify-center">
      <Radar size={size} className="text-accent glow" strokeWidth={1.75} />
    </span>
  );
}

export function ModeBadge() {
  const live = CRAWL_MODE === "live";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] tracking-wider uppercase"
      style={{
        borderColor: live ? "rgba(82,255,168,0.4)" : "rgba(255,180,84,0.4)",
        color: live ? "var(--color-accent)" : "var(--color-amber)",
        background: live ? "rgba(82,255,168,0.08)" : "rgba(255,180,84,0.08)",
      }}
    >
      {live ? <TerminalSquare size={11} /> : <FlaskConical size={11} />}
      {live ? "tor en vivo · socks5" : "red simulada"}
    </span>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line/80 bg-void/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="group flex items-center gap-2.5">
          <Logo />
          <span className="font-display text-lg font-bold tracking-[0.28em] text-ink transition-colors group-hover:text-accent">
            FARO
          </span>
          <span className="hidden text-[10px] tracking-[0.2em] text-faint uppercase sm:inline">
            buscador .onion
          </span>
        </Link>
        <nav className="flex items-center gap-2 sm:gap-4">
          <ModeBadge />
          <Link
            href="/"
            className="text-xs tracking-wider text-dim uppercase transition-colors hover:text-accent"
          >
            Buscador
          </Link>
          <Link
            href="/ops"
            className="text-xs tracking-wider text-dim uppercase transition-colors hover:text-accent"
          >
            Panel&nbsp;de&nbsp;ops
          </Link>
        </nav>
      </div>
    </header>
  );
}

// Los indicadores puros (StatusDot, UptimeBar) viven en indicators.tsx
// para que los componentes cliente no arrastren módulos de Node.

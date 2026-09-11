import type { Metadata } from "next";
import type { ReactNode } from "react";
import { JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { SiteHeader } from "@/components/chrome";
import "./globals.css";

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono-var",
});

const display = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display-var",
});

export const metadata: Metadata = {
  title: "FARO — Buscador de servicios .onion",
  description:
    "Motor de búsqueda para la red Tor: rastreo vía SOCKS5, health checks en tiempo real, deduplicación de espejos y blocklists.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" className={`${mono.variable} ${display.variable}`}>
      <body className="bg-void bg-void-grid scanlines antialiased">
        <SiteHeader />
        <main className="mx-auto w-full max-w-6xl px-4 pb-24 sm:px-6">{children}</main>
      </body>
    </html>
  );
}

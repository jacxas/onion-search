import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FARO — buscador .onion",
  description: "Motor de búsqueda para servicios .onion con estado verificado.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}

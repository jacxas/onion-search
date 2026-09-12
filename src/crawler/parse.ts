// FARO — extracción HTML (cheerio): título, meta description, texto y enlaces
// .onion. Migrado de crawler/spider.py (BeautifulSoup → cheerio).

import * as cheerio from "cheerio";
import { normalizeOnionUrl } from "../lib/onion";

export interface ParsedPage {
  title: string;
  description: string | null;
  text: string; // texto visible, normalizado, cap 10.000 chars (como legacy)
  links: string[]; // URLs .onion normalizadas y únicas
}

/**
 * Extrae título, descripción, texto visible y todos los enlaces .onion
 * (absolutos o relativos a `baseUrl`), normalizados y sin duplicados.
 */
export function parsePage(html: string, baseUrl: string): ParsedPage {
  const $ = cheerio.load(html);
  const title = ($("title").first().text() || "").trim();
  const description = ($('meta[name="description"]').attr("content") || "").trim() || null;
  $("script, style, noscript").remove();
  const text = ($("body").text() || $("html").text() || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 10_000);

  const seen = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = ($(el).attr("href") || "").trim();
    if (!href || /^(javascript:|mailto:|data:|#)/i.test(href)) return;
    let abs: string;
    try {
      abs = new URL(href, baseUrl).toString();
    } catch {
      return;
    }
    const n = normalizeOnionUrl(abs);
    if (n.ok) seen.add(n.url);
  });
  return { title, description, text, links: [...seen] };
}

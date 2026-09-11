import * as cheerio from "cheerio";
import { contentFingerprint, normalizeOnionUrl } from "@/lib/onion";

export interface ParsedPage {
  title: string;
  description: string;
  text: string;
  lang: string;
  links: string[]; // URLs .onion absolutas, normalizadas y únicas
  hash: string; // fingerprint de contenido (dedupe de mirrors)
}

const MAX_TEXT = 20000;

/** Extrae título, metadescription, texto limpio y enlaces .onion del HTML. */
export function parsePage(html: string, pageUrl: string): ParsedPage {
  const $ = cheerio.load(html);

  $("script, style, noscript, svg, iframe").remove();

  const title =
    ($("title").first().text() || $("h1").first().text() || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 300) || "(sin título)";

  const description = (
    $('meta[name="description"]').attr("content") ??
    $("p").first().text() ??
    ""
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);

  const lang = ($("html").attr("lang") || "").slice(0, 8);
  const text = $("body")
    .text()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT);

  const links = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
    let abs: string;
    try {
      abs = new URL(href, pageUrl).toString();
    } catch {
      return;
    }
    const n = normalizeOnionUrl(abs);
    if (!n) return;
    if (n.url === pageUrl) return;
    links.add(n.url);
  });

  return {
    title,
    description,
    text,
    lang,
    links: [...links],
    hash: contentFingerprint(html),
  };
}

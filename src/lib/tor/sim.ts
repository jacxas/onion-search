// FARO — SimTransport: red onion simulada determinista (~46 hosts).
// Mismos dominios, contenidos, latencias y caídas en cada ejecución:
// la seed es fija. Reemplaza mocks frágiles con una red real indexable.

import { makeRng, randomOnionHost, sha256Hex, type Rng } from "../onion";
import type { OnionTransport, TransportFetchOptions, TransportResponse } from "./transport";

const SIM_SEED = "faro-sim-v1";
const TOTAL_HOSTS = 46;
const HUBS = 4; // primeros 4 hosts: hubs con muchos enlaces (semillas)

const TOPICS = [
  "market", "forum", "wiki", "blog", "archive", "library", "mail", "paste",
  "chat", "search", "storage", "news", "radio", "wallet", "escrow", "mirror",
  "board", "gallery", "index", "directory",
];

const ADJECTIVES = [
  "silent", "hidden", "dark", "secure", "anon", "private", "encrypted",
  "free", "open", "deep", "quiet", "fast", "safe", "solid", "nordic",
  "arctic", "neon", "retro", "vapor", "quantum",
];

const KEYWORDS = [
  "onion", "tor", "hidden service", "anonymous", "market", "forum", "wiki",
  "mirror", "archive", "privacy", "encrypted", "board", "paste", "storage",
  "email", "search engine", "directory", "news", "radio", "wallet",
];

const SENTENCES = [
  "Este servicio opera como nodo oculto en la red Tor.",
  "Contenido comunitario, público y sin registro.",
  "Los espejos sincronizan cada 6 horas.",
  "Acceso directo por dominio v3, sin JavaScript.",
  "Foro de discusión con archivos históricos indexados.",
  "Archivo público de documentos y enlaces verificados.",
  "Buzón anónimo con retención de 30 días.",
  "Directorio de servicios .onion verificados por la comunidad.",
];

interface SimHost {
  domain: string;
  name: string; // "silent-market"
  description: string;
  body: string;
  links: number[]; // índices de otros hosts
  latencyMs: number;
  availabilityPct: number; // 0..100
  periodMs: number; // ventana de disponibilidad
  offset: number; // fase de la ventana
  hasAbout: boolean;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function buildNetwork(): SimHost[] {
  const rng = makeRng(SIM_SEED);
  const hosts: SimHost[] = [];

  for (let i = 0; i < TOTAL_HOSTS; i++) {
    const topic = TOPICS[i % TOPICS.length];
    const adj = ADJECTIVES[(i * 7) % ADJECTIVES.length];
    const name = `${adj}-${topic}`;
    // 3 keywords estables por host, deterministas
    const kw = [
      KEYWORDS[i % KEYWORDS.length],
      KEYWORDS[(i * 3 + 5) % KEYWORDS.length],
      KEYWORDS[(i * 11 + 2) % KEYWORDS.length],
    ];
    const s1 = SENTENCES[i % SENTENCES.length];
    const s2 = SENTENCES[(i * 5 + 3) % SENTENCES.length];
    hosts.push({
      domain: randomOnionHost(rng),
      name,
      description: `${name}: ${kw.join(", ")} — servicio .onion verificado`,
      body: `Bienvenido a ${name}, un servicio onion dedicado a ${kw[0]}. ` +
        `${s1} ${s2} Temas activos: ${kw.join(", ")}. ` +
        `Este nodo forma parte del índice FARO con contenido sobre ${kw[0]} y ${kw[2]}.`,
      links: [],
      latencyMs: 80 + Math.floor(rng() * 1400),
      availabilityPct: i === TOTAL_HOSTS - 1 ? 0 : i % 17 === 5 ? 40 : i % 11 === 7 ? 75 : 95,
      periodMs: 15 * 60_000 + Math.floor(rng() * 90) * 60_000,
      offset: Math.floor(rng() * 1000),
      hasAbout: i % 3 === 0,
    });
  }

  // Grafo conectado: hubs (0..3) con 8-10 enlaces; el resto 1-4.
  for (let i = 0; i < TOTAL_HOSTS; i++) {
    const rng2 = makeRng(`${SIM_SEED}:links:${i}`);
    const count = i < HUBS ? 8 + Math.floor(rng2() * 3) : 1 + Math.floor(rng2() * 4);
    const links = new Set<number>();
    // si no es hub, enlaza a un hub para garantizar conectividad
    links.add(i < HUBS ? (i + 1) % HUBS : Math.floor(rng2() * HUBS));
    while (links.size < count) {
      const j = Math.floor(rng2() * TOTAL_HOSTS);
      if (j !== i) links.add(j);
    }
    hosts[i].links = [...links];
  }
  // espejo determinista del hub 0 (mismo contenido exacto: valida dedupe/mirrors).
  // Se descubre desde el hub 0 y copia SUS enlaces finales → HTML idéntico.
  hosts[0].links.push(hosts.length);
  hosts.push({
    ...hosts[0],
    domain: randomOnionHost(rng),
    links: [...hosts[0].links],
  });
  return hosts;
}

/** Disponibilidad determinista por ventana temporal (caídas reproducibles). */
function isHostUp(host: SimHost, now: number): boolean {
  if (host.availabilityPct >= 100) return true;
  if (host.availabilityPct <= 0) return false;
  const epoch = Math.floor(now / host.periodMs) + host.offset;
  const h = parseInt(sha256Hex(`${SIM_SEED}:${host.domain}:${epoch}`).slice(0, 8), 16);
  return h % 100 < host.availabilityPct;
}

function hostIndex(net: SimHost[], domain: string): number {
  return net.findIndex((h) => h.domain === domain);
}

function pageHtml(net: SimHost[], host: SimHost, path: string): string {
  const base = `http://${host.domain}`;
  const links = host.links
    .map((j) => `<li><a href="http://${net[j].domain}/">${escapeHtml(net[j].name)}</a></li>`)
    .join("\n");
  const about = host.hasAbout
    ? `<a href="${base}/about">about</a>`
    : "";
  if (path === "/" || path === "/index.html") {
    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${escapeHtml(host.name)}</title>
<meta name="description" content="${escapeHtml(host.description)}">
</head><body><h1>${escapeHtml(host.name)}</h1>
<p>${escapeHtml(host.body)}</p>
<p>${about}</p>
<h2>Enlaces</h2><ul>${links}</ul>
</body></html>`;
  }
  if (path === "/about" && host.hasAbout) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${escapeHtml(host.name)} — about</title>
<meta name="description" content="Acerca de ${escapeHtml(host.name)}">
</head><body><h1>About ${escapeHtml(host.name)}</h1>
<p>${escapeHtml(host.body)}</p>
<p><a href="${base}/">inicio</a></p>
<h2>Enlaces</h2><ul>${links}</ul>
</body></html>`;
  }
  // 404 con enlaces de vuelta (típico en servicios onion)
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>404</title></head>
<body><h1>404</h1><p><a href="${base}/">volver al inicio</a></p><ul>${links}</ul></body></html>`;
}

export interface SimTransport extends OnionTransport {
  /** Dominios de los hubs (semillas del índice). */
  seedDomains(): string[];
  /** Todos los dominios (para tests/verificación). */
  allDomains(): string[];
}

export function makeSimTransport(): SimTransport {
  const net = buildNetwork();
  const byDomain = new Map<string, { host: SimHost; idx: number }>();
  net.forEach((host, idx) => byDomain.set(host.domain, { host, idx }));

  return {
    mode: "sim",
    name: "sim(faro-sim-v1)",

    async fetch(url, opts: TransportFetchOptions = {}): Promise<TransportResponse> {
      const maxBytes = opts.maxBytes ?? 512 * 1024;
      const started = Date.now();
      const fail = (error: string, status = 0): TransportResponse => ({
        url, ok: false, status, body: null, contentType: null,
        elapsedMs: Date.now() - started, error,
      });

      let u: URL;
      try {
        u = new URL(url);
      } catch {
        return fail("invalid_url");
      }
      const entry = byDomain.get(u.hostname);
      if (!entry) return fail("connection refused (host desconocido en red sim)");

      const { host } = entry;
      const now = Date.now();
      if (!isHostUp(host, now)) {
        // unreachable: espera algo de tiempo para simular circuito muerto
        await new Promise((r) => setTimeout(r, Math.min(host.latencyMs, 300)));
        return fail("host unreachable (down)", 0);
      }

      // latencia simulada determinista (cap 1.5s para pipelines ágiles)
      await new Promise((r) => setTimeout(r, host.latencyMs));
      const path = u.pathname === "" ? "/" : u.pathname;
      const status = path === "/" || path === "/index.html" || (path === "/about" && host.hasAbout) ? 200 : 404;
      const body = pageHtml(net, host, path).slice(0, maxBytes);
      return {
        url,
        ok: status === 200,
        status,
        body,
        contentType: "text/html; charset=utf-8",
        elapsedMs: Date.now() - started,
        error: status === 404 ? "not_found" : null,
      };
    },

    seedDomains() {
      return net.slice(0, HUBS).map((h) => h.domain);
    },

    allDomains() {
      return net.map((h) => h.domain);
    },
  };
}

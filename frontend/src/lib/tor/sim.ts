import {
  onionAddressFromSeed,
  seededRng,
  pick,
  sha256Hex,
} from "@/lib/onion";

/**
 * Red Tor simulada y DETERMINISTA.
 * Sirve para desarrollar y verificar todo el pipeline (crawl → dedupe →
 * health check → búsqueda FTS) sin necesidad de un proxy Tor activo.
 * En producción: CRAWL_MODE=live + TOR_SOCKS_PROXY=socks5h://127.0.0.1:9050
 */

export interface SimNode {
  seed: string;
  domain: string;
  nickname: string;
  topic: string;
  online: boolean; // estable
  flakes: number; // 0..1 probabilidad de fallo intermitente
  pages: number;
  lang: "es" | "en";
  mirrorOf?: string; // seed de la cual es espejo
}

const HUBS: Array<[string, string, string, "es" | "en"]> = [
  ["wiki", "Wiki Oculta", "directorio y enlaces verificados de servicios onion", "es"],
  ["farol", "El Farol", "foro comunitario de privacidad y anonimato", "es"],
  ["archivo", "Archivo del Abismo", "biblioteca digital de textos clásicos y papers", "es"],
  ["relay", "Relay Watch", "métricas y estado de la red tor en tiempo real", "en"],
  ["postal", "Correo Cifrado", "servicio de correo electrónico cifrado extremo a extremo", "es"],
  ["bunker", "El Búnker", "noticias y filtraciones de periodismo de investigación", "es"],
  ["sable", "Sable Oscuro", "herramientas osint y seguridad ofensiva ética", "es"],
  ["oraculo", "Oráculo", "análisis de mercados cripto y privacidad financiera", "es"],
  ["nodo", "Nodo Fantasma", "hosting anonimo v3 y guías de configuración de tor", "en"],
  ["espejo", "Casa de Espejos", "mirror oficial de la wiki oculta con enlaces verificados", "es"],
];

const FRAGS_ES = [
  "acceso verificado", "espejo activo", "sin rastreo", "pgp disponible",
  "actualizado esta semana", "registro anónimo", "cifrado extremo a extremo",
  "nodo v3 estable", "comunidad moderada", "sin javascript",
  "auditoría abierta", "enlaces comprobados", "uptime histórico alto",
  "respaldado por voluntarios", "documentación en español",
];
const FRAGS_EN = [
  "verified mirrors", "no logs policy", "signed canary", "open source",
  "onion v3 only", "tor project member", "clearnet gateway disabled",
  "pgp signed", "rate limited api", "status page included",
];

const PARAS_ES = [
  "Este servicio oculto se mantiene de forma voluntaria y no registra direcciones IP ni huellas del navegador.",
  "Todos los enlaces publicados aquí se verifican a mano cada semana; los espejos caídos se retiran del índice.",
  "Para colaborar, revisa la sección de contacto y firma tus mensajes con la llave pública indicada al pie.",
  "La disponibilidad de los servicios onion es variable: si un enlace no responde, reintenta más tarde o usa un espejo.",
  "Recuerda verificar siempre la huella del certificado y la dirección completa antes de ingresar credenciales.",
  "Este nodo corre detrás de tres saltos y no guarda registros de acceso en disco.",
];
const PARAS_EN = [
  "This hidden service is community operated and keeps no access logs of any kind.",
  "All listed links are hand-verified weekly; dead mirrors are pruned from the index automatically.",
  "Expect variable latency: onion circuits are slow and some relays saturate during peak hours.",
  "Always verify the full address and tls fingerprint before entering any credentials.",
  "This node runs behind three hops and writes nothing to disk beyond this page.",
];

function buildNetwork(): SimNode[] {
  const nodes: SimNode[] = [];
  for (const [seed, nick, topic, lang] of HUBS) {
    const rng = seededRng(`hub:${seed}`);
    nodes.push({
      seed,
      domain: onionAddressFromSeed(seed),
      nickname: nick,
      topic,
      online: rng() > 0.12, // algunos hubs caídos
      flakes: rng() * 0.25,
      pages: 3 + Math.floor(rng() * 6),
      lang,
    });
  }
  // espejos explícitos de la wiki y del búnker (mismo contenido → dedupe)
  const wikiDomain = onionAddressFromSeed("wiki-mirror");
  nodes.push({
    seed: "wiki-mirror",
    domain: wikiDomain,
    nickname: "Wiki Oculta (espejo)",
    topic: HUBS[0][2],
    online: true,
    flakes: 0.1,
    pages: 2,
    lang: "es",
    mirrorOf: "wiki",
  });
  // ~36 nodos anónimos alcanzables solo por descubrimiento de enlaces
  for (let i = 0; i < 36; i++) {
    const seed = `anon-${i}`;
    const rng = seededRng(seed);
    const lang = rng() > 0.45 ? "es" : "en";
    const topics =
      lang === "es"
        ? ["foro temático", "blog personal", "chat efímero", "pastebin anónimo",
           "radio comunitaria", "wiki de nicho", "tablón de imágenes", "biblioteca zines"]
        : ["paste service", "encrypted dropbox", "security research blog",
           "anonymous chat", "status dashboard", "personal blog", "file drop"];
    nodes.push({
      seed,
      domain: onionAddressFromSeed(seed),
      nickname: `${lang === "es" ? "Servicio" : "Service"} ${seed.toUpperCase()}`,
      topic: pick(rng, topics),
      online: rng() > 0.2,
      flakes: rng() * 0.35,
      pages: 1 + Math.floor(rng() * 4),
      lang,
    });
  }
  return nodes;
}

export const SIM_NETWORK = buildNetwork();
export const SIM_HUB_SEEDS = [
  ...HUBS.map(([seed]) => onionAddressFromSeed(seed)),
  onionAddressFromSeed("wiki-mirror"),
];

const nodeByDomain = new Map(SIM_NETWORK.map((n) => [n.domain, n]));

function linksFor(node: SimNode, rng: () => number, count: number): SimNode[] {
  const out: SimNode[] = [];
  const targets = SIM_NETWORK.filter((n) => n.domain !== node.domain);
  for (let i = 0; i < count; i++) {
    out.push(targets[Math.floor(rng() * targets.length)]);
  }
  return out;
}

function pageTitle(node: SimNode, path: string, rng: () => number): string {
  if (path === "/" || path === "") return `${node.nickname} — ${node.topic}`;
  const slug = path.slice(1).replace(/[-_/]/g, " ").trim() || "sección";
  const cap = slug[0].toUpperCase() + slug.slice(1);
  const frags = node.lang === "es" ? FRAGS_ES : FRAGS_EN;
  return `${cap} · ${node.nickname} · ${pick(rng, frags)}`;
}

function paragraph(node: SimNode, rng: () => number): string {
  const src = node.lang === "es" ? PARAS_ES : PARAS_EN;
  const frags = node.lang === "es" ? FRAGS_ES : FRAGS_EN;
  return `${pick(rng, src)} ${pick(rng, src)} (${pick(rng, frags)}).`;
}

export function simFetch(url: string): {
  ok: boolean;
  status: number;
  ms: number;
  html?: string;
  error?: string;
} {
  let u: URL;
  try {
    u = new URL(url.startsWith("http") ? url : `http://${url}`);
  } catch {
    return { ok: false, status: 0, ms: 1200, error: "url inválida" };
  }
  const node = nodeByDomain.get(u.hostname.toLowerCase());

  // dominio desconocido dentro de la simulación → timeout
  if (!node) {
    const r0 = seededRng(`miss:${url}`);
    return {
      ok: false,
      status: 0,
      ms: 8000 + Math.floor(r0() * 22000),
      error: "onion service unreachable (sim timeout)",
    };
  }

  const rng = seededRng(`${url}#page`);
  const ms = 400 + Math.floor(Math.pow(rng(), 2) * 6500);

  // chequeo de salud base: ¿siempre caído?
  const health = seededRng(`health:${node.domain}`);
  if (!node.online && health() > 0.06) {
    return { ok: false, status: 0, ms, error: "connection refused (sim offline)" };
  }
  // inestabilidad intermitente
  if (rng() < node.flakes * 0.5) {
    return { ok: false, status: 0, ms, error: "socks timeout (sim flaky)" };
  }

  // Los espejos sirven el CONTENIDO exacto de su canónico → mismo fingerprint
  // SHA-256 del texto normalizado → el pipeline los agrupa como mirrors.
  const contentNode = node.mirrorOf
    ? (nodeByDomain.get(onionAddressFromSeed(node.mirrorOf)) ?? node)
    : node;

  const path = (u.pathname || "/").replace(/\/+$/, "") || "/";
  const pRng = seededRng(`${contentNode.domain}${path}`);
  const title = pageTitle(contentNode, path, pRng);
  const descFrags = contentNode.lang === "es" ? FRAGS_ES : FRAGS_EN;
  const description = `${contentNode.topic} · ${pick(pRng, descFrags)} · ${pick(pRng, descFrags)}`;
  const paras = Array.from({ length: 3 + Math.floor(pRng() * 4) }, () =>
    paragraph(contentNode, pRng),
  );
  const links = linksFor(contentNode, pRng, 4 + Math.floor(pRng() * 6));

  const subLinks = Array.from({ length: 2 + Math.floor(pRng() * 2) }, (_, i) => {
    const slug = `${pick(pRng, ["guia", "claves", "espejos", "indice", "notas", "hilo", "lista", "doc"])
      }-${Math.floor(pRng() * 90) + 10}`;
    return `<a href="http://${contentNode.domain}/${slug}">${contentNode.lang === "es" ? "Sección" : "Section"} ${i + 1}</a>`;
  });

  const anchors = links
    .map((l) => `<a href="http://${l.domain}/">${l.nickname}</a>`)
    .join("\n");

  const html = `<!doctype html>
<html lang="${contentNode.lang}">
<head>
<meta charset="utf-8">
<title>${title}</title>
<meta name="description" content="${description}">
</head>
<body>
<h1>${title}</h1>
${paras.map((p) => `<p>${p}</p>`).join("\n")}
<nav>
${subLinks.join("\n")}
${anchors}
</nav>
<footer>fingerprint ${sha256Hex(contentNode.domain).slice(0, 16)} · tor v3</footer>
</body>
</html>`;

  return { ok: true, status: 200, ms, html };
}

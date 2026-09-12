// FARO — worker del crawler (proceso separado de Next.js).
// Ejecutar:  npm run worker   (o node --experimental-strip-types worker/crawler.ts)
// Ciclo: pipeline de rastreo → barrido de salud → resumen. Sale con código 0.

import "dotenv/config";
import { pool } from "../src/db/index";
import { ensureSearchIndexes } from "../src/lib/search";
import { healthSweep } from "../src/crawler/health";
import { runPipeline } from "../src/crawler/pipeline";
import { getConfig } from "../src/lib/config";
import { getTransport } from "../src/lib/tor/transport";

interface WorkerOptions {
  maxPages?: number;
  healthLimit?: number;
  skipHealth?: boolean;
}

async function main(): Promise<void> {
  const cfg = getConfig();
  const args = new Set(process.argv.slice(2));
  const opts: WorkerOptions = {
    maxPages: Number(process.env.WORKER_MAX_PAGES ?? 60),
    healthLimit: Number(process.env.WORKER_HEALTH_LIMIT ?? 40),
    skipHealth: args.has("no-health"),
  };

  console.log(`[faro-worker] modo=${cfg.crawlMode} · db=${cfg.databaseUrl ? "ok" : "FALTA"}`);
  if (!cfg.databaseUrl) {
    console.error("[faro-worker] DATABASE_URL no definida — aborta");
    process.exit(1);
  }

  await ensureSearchIndexes();

  console.log("[faro-worker] pipeline de rastreo…");
  const crawl = await runPipeline({ maxPages: opts.maxPages });
  console.log(
    `[faro-worker] crawl: intentados=${crawl.attempted} ok=${crawl.crawled} ` +
      `fallidos=${crawl.failed} bloqueados=${crawl.blocked} descubiertos=${crawl.discovered} ` +
      `pendientes=${crawl.pending} (${(crawl.elapsedMs / 1000).toFixed(1)}s)`
  );

  if (!opts.skipHealth) {
    console.log("[faro-worker] barrido de salud…");
    const sweep = await healthSweep(getTransport(), { limit: opts.healthLimit });
    console.log(
      `[faro-worker] salud: chequeados=${sweep.checked} up=${sweep.up} down=${sweep.down} ` +
        `transiciones=${sweep.transitions.length}`
    );
  }

  await pool().end();
  console.log("[faro-worker] listo");
}

main().catch((e) => {
  console.error("[faro-worker] error fatal:", e);
  process.exit(1);
});

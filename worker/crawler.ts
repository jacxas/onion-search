// FARO — worker del crawler (proceso separado de Next.js).
// Ejecutar:  npm run worker   (o node .worker-build/worker/crawler.js)
//
// Modos (WORK-01):
//   - one-shot (default): un ciclo seed→crawl→health y sale con 0.
//   - bucle: WORKER_INTERVAL_SECONDS=<n> repite el ciclo cada n segundos
//     (shutdown limpio con SIGTERM/SIGINT: termina el ciclo en curso y sale).
//
// Este proceso es el ÚNICO responsable de programar las ejecuciones de crawl
// y health. /ops y /api/admin/run solo observan o disparan acciones puntuales.

async function loadDotenv(): Promise<void> {
  try {
    await import("dotenv/config"); // dev: lee .env. Imagen standalone: usa env del proceso
  } catch {
    /* dotenv ausente en la imagen — las vars vienen del orchestrator */
  }
}

import { pool } from "../src/db/index";
import { healthSweep } from "../src/crawler/health";
import { runPipeline } from "../src/crawler/pipeline";
import { getConfig } from "../src/lib/config";
import { getTransport } from "../src/lib/tor/transport";
import { ensureInitialAdmin } from "../src/lib/admin-bootstrap";

interface WorkerOptions {
  maxPages?: number;
  healthLimit?: number;
  skipHealth?: boolean;
}

let stopping = false;

function sleepInterruptible(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const poll = setInterval(() => {
      if (stopping) {
        clearInterval(poll);
        clearTimeout(cap);
        resolve();
      }
    }, 250);
    const cap = setTimeout(() => {
      clearInterval(poll);
      resolve();
    }, ms);
  });
}

async function cycle(opts: WorkerOptions): Promise<void> {
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
}

async function main(): Promise<void> {
  await loadDotenv();
  const cfg = getConfig();
  const args = new Set(process.argv.slice(2));
  const intervalSec = Math.max(Number(process.env.WORKER_INTERVAL_SECONDS ?? 0) || 0, 0);
  const opts: WorkerOptions = {
    maxPages: Number(process.env.WORKER_MAX_PAGES ?? 60),
    healthLimit: Number(process.env.WORKER_HEALTH_LIMIT ?? 40),
    skipHealth: args.has("no-health"),
  };

  console.log(`[faro-worker] modo=${cfg.crawlMode} · db=${cfg.databaseUrl ? "ok" : "FALTA"} · intervalo=${intervalSec ? `${intervalSec}s` : "one-shot"}`);
  if (!cfg.databaseUrl) {
    console.error("[faro-worker] DATABASE_URL no definida — aborta");
    process.exit(1);
  }

  // Primer arranque: provisionar el admin inicial. En producción sin
  // credenciales válidas esto falla de forma explícita (SEC-01).
  try {
    await ensureInitialAdmin();
    console.log("[faro-worker] admin bootstrap OK");
  } catch (e) {
    console.error(`[faro-worker] ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }

  process.on("SIGTERM", () => {
    console.log("[faro-worker] SIGTERM — cerrando tras el ciclo en curso…");
    stopping = true;
  });
  process.on("SIGINT", () => {
    stopping = true;
  });

  if (!intervalSec) {
    await cycle(opts);
  } else {
    while (!stopping) {
      await cycle(opts);
      if (stopping) break;
      console.log(`[faro-worker] duerme ${intervalSec}s`);
      await sleepInterruptible(intervalSec * 1000);
    }
  }

  await pool().end();
  console.log("[faro-worker] shutdown limpio");
}

main().catch((e) => {
  console.error("[faro-worker] error fatal:", e);
  process.exit(1);
});

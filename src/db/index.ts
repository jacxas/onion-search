// FARO — conexión PostgreSQL (drizzle + pg), singleton seguro para
// Next (hot-reload) y para el worker en Node puro.

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getConfig } from "../lib/config";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

// globalThis sobrevive al hot-reload de Next en dev
const g = globalThis as typeof globalThis & { __faroPool?: Pool };

export function pool(): Pool {
  if (!g.__faroPool) {
    const url = getConfig().databaseUrl;
    if (!url) throw new Error("DATABASE_URL no está definida (ver .env.example)");
    g.__faroPool = new Pool({ connectionString: url, max: 10, idleTimeoutMillis: 30_000 });
  }
  return g.__faroPool;
}

export function db(): Database {
  return drizzle(pool(), { schema });
}

export { schema };

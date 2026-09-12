// FARO — bootstrap del admin inicial (primer arranque). Módulo separado de
// auth.ts para que el worker pueda provisionar/validar en su arranque sin
// importar next/headers. En producción exige credenciales reales (SEC-01);
// después del primer arranque la autenticación vive en la DB (hash scrypt).

import { sql } from "drizzle-orm";
import { db } from "../db";
import { adminUsers } from "../db/schema";
import { getConfig, validateAdminBootstrap } from "./config";
import { hashPassword } from "./password";

/**
 * Crea el admin inicial si la tabla está vacía (idempotente). Las variables
 * ADMIN_INITIAL_* solo se exigen en el PRIMER arranque: si el admin ya existe,
 * la autenticación vive en la DB y no depende del entorno.
 */
export async function ensureInitialAdmin(): Promise<void> {
  const cfg = getConfig();
  const d = db();
  const res = await d.select({ n: sql<number>`count(*)::int` }).from(adminUsers);
  if (Number(res[0]?.n ?? 0) > 0) return; // ya provisionado: nada que bootstrapear

  const v = validateAdminBootstrap(cfg.adminInitialEmail, cfg.adminInitialPassword);
  if (!v.ok) throw new Error(`[FARO] bootstrap admin: ${v.error}`);
  if (!cfg.adminInitialPassword) throw new Error("[FARO] bootstrap admin: sin ADMIN_INITIAL_PASSWORD");
  await d.insert(adminUsers).values({ email: cfg.adminInitialEmail, passwordHash: hashPassword(cfg.adminInitialPassword) })
    .onConflictDoNothing();
}

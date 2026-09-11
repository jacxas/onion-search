"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { blocklist, reports } from "@/db/schema";
import { enqueueUrl, recordEvent } from "@/lib/crawler/pipeline";
import { normalizeOnionUrl } from "@/lib/onion";
import { changePassword, requireAdmin } from "@/lib/auth";
import { sendAlert } from "@/lib/mail";

export type ActionResult = { ok: boolean; message: string };

export async function addSeedAction(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const raw = String(formData.get("url") ?? "").trim();
  if (!raw) return { ok: false, message: "Ingresá una dirección .onion" };
  const r = await enqueueUrl(raw, { priority: 8, isSeed: true });
  if (!r.ok) return { ok: false, message: r.error ?? "URL inválida" };
  await recordEvent("seed", `Semilla agregada manualmente: ${raw.slice(0, 80)}`);
  revalidatePath("/ops");
  return { ok: true, message: "Semilla encolada para el próximo lote" };
}

export async function addBlockAction(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const type = String(formData.get("type") ?? "domain");
  const value = String(formData.get("value") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim() || null;
  if (!value) return { ok: false, message: "Valor vacío" };
  if (!["domain", "hash", "keyword"].includes(type))
    return { ok: false, message: "Tipo inválido" };
  if (type === "domain" && !value.includes("onion"))
    return { ok: false, message: "El dominio debe ser .onion" };

  await db
    .insert(blocklist)
    .values({ type, value, reason, source: "manual" })
    .onConflictDoNothing();
  if (type === "domain") {
    const n = normalizeOnionUrl(value);
    if (n) {
      await db.execute(sql`
        UPDATE onion_sites SET is_blocked = true, blocked_reason = ${reason ?? "blocklist manual"}
        WHERE domain = ${n.domain}`);
    }
  }
  await recordEvent("block", `Blocklist +: [${type}] ${value.slice(0, 60)}`);
  revalidatePath("/ops");
  return { ok: true, message: `Bloqueado: ${value.slice(0, 40)}` };
}

export async function removeBlockAction(id: number): Promise<ActionResult> {
  await requireAdmin();
  await db.delete(blocklist).where(eq(blocklist.id, id));
  revalidatePath("/ops");
  return { ok: true, message: "Regla eliminada" };
}

/** Re-encola el dominio para rastreo inmediato (ficha de nodo). */
export async function recrawlAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const raw = String(formData.get("url") ?? "");
  await enqueueUrl(raw, { priority: 9 });
  await recordEvent("seed", `Re-rastreo solicitado: ${raw.slice(0, 80)}`);
  revalidatePath("/ops");
}

/** Bloquea el dominio completo desde la ficha de nodo. */
export async function blockDomainAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const domain = String(formData.get("domain") ?? "");
  const n = normalizeOnionUrl(domain);
  const value = n?.domain ?? domain;
  await db
    .insert(blocklist)
    .values({ type: "domain", value, reason: "bloqueado desde ficha", source: "manual" })
    .onConflictDoNothing();
  await db.execute(sql`
    UPDATE onion_sites SET is_blocked = true, blocked_reason = 'blocklist manual'
    WHERE domain = ${value}`);
  await recordEvent("block", `Dominio bloqueado manualmente: ${value}`);
  revalidatePath("/ops");
}

export async function reportUrlAction(formData: FormData): Promise<ActionResult> {
  const url = String(formData.get("url") ?? "").trim();
  const reason = String(formData.get("reason") ?? "otro");
  const details = String(formData.get("details") ?? "").trim().slice(0, 1000) || null;
  if (!url) return { ok: false, message: "URL requerida" };
  await db.insert(reports).values({ url, reason, details });
  await recordEvent("system", `Reporte de usuario: ${url.slice(0, 60)} (${reason})`);
  void sendAlert({
    subject: `reporte de usuario (${reason})`,
    text: `URL: ${url}\nMotivo: ${reason}${details ? `\nDetalle: ${details}` : ""}\n\nRevisalo en el panel /ops → reportes.`,
  }).catch(() => false);
  revalidatePath("/ops");
  return { ok: true, message: "Reporte recibido. Se revisará en la próxima tanda." };
}

/** Cambio de contraseña del admin logueado (invalida otras sesiones). */
export async function changePasswordAction(formData: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  if (next.length < 8) return { ok: false, message: "La nueva clave necesita ≥ 8 caracteres" };
  const ok = await changePassword(session.userId, current, next);
  return ok
    ? { ok: true, message: "Contraseña actualizada — volvé a ingresar" }
    : { ok: false, message: "La contraseña actual no coincide" };
}

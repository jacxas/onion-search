"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { blocklist, reports, sites } from "@/db/schema";
import { getSessionUser, changePassword, destroySession } from "@/lib/auth";
import { runPipeline } from "@/crawler/pipeline";
import { healthSweep } from "@/crawler/health";
import { getTransport } from "@/lib/tor/transport";
import { seedQueue } from "@/crawler/queue";
import { alertTransitions, sendAlert } from "@/lib/mail";
import { normalizeOnionUrl } from "@/lib/onion";

async function assertAdmin() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}

export async function runCrawlAction(formData: FormData): Promise<void> {
  await assertAdmin();
  const maxPages = Math.min(Number(formData.get("maxPages") ?? 30) || 30, 200);
  await runPipeline({ maxPages });
  revalidatePath("/ops");
}

export async function runHealthAction(): Promise<void> {
  await assertAdmin();
  const sweep = await healthSweep(getTransport(), { limit: 60 });
  await alertTransitions(sweep.transitions);
  revalidatePath("/ops");
}

export async function addSeedAction(formData: FormData): Promise<void> {
  await assertAdmin();
  const raw = String(formData.get("seeds") ?? "");
  const seeds = raw.split(/[\s,]+/).filter(Boolean);
  if (seeds.length) await seedQueue(seeds);
  revalidatePath("/ops");
}

export async function blockDomainAction(formData: FormData): Promise<void> {
  const user = await assertAdmin();
  const domain = String(formData.get("domain") ?? "").trim();
  const reason = String(formData.get("reason") ?? "manual").trim() || "manual";
  if (!domain) return;
  await db().insert(blocklist).values({ pattern: domain.slice(0, 255), reason }).onConflictDoNothing();
  await db().update(sites).set({ blocked: true, blockReason: reason }).where(eq(sites.domain, domain));
  await sendAlert("block", domain, `Bloqueado: ${domain}`, `${user.email} bloqueó ${domain} (${reason}).`);
  revalidatePath("/ops");
  revalidatePath(`/sitio/${domain}`);
}

export async function unblockDomainAction(formData: FormData): Promise<void> {
  await assertAdmin();
  const domain = String(formData.get("domain") ?? "").trim();
  if (!domain) return;
  await db().delete(blocklist).where(eq(blocklist.pattern, domain));
  await db().update(sites).set({ blocked: false, blockReason: null }).where(eq(sites.domain, domain));
  revalidatePath("/ops");
  revalidatePath(`/sitio/${domain}`);
}

export async function resolveReportAction(formData: FormData): Promise<void> {
  await assertAdmin();
  const id = Number(formData.get("id"));
  const status = String(formData.get("status") ?? "reviewed");
  if (!Number.isFinite(id)) return;
  await db().update(reports).set({ status: status.slice(0, 16) }).where(eq(reports.id, id));
  revalidatePath("/ops");
}

export async function changePasswordAction(formData: FormData): Promise<void> {
  const user = await assertAdmin();
  const next = String(formData.get("newPassword") ?? "");
  if (next.length < 8) return;
  await changePassword(user.id, next);
  redirect("/login");
}

/** Utilidad para validar URLs semilla desde formularios (reutilizable). */
export async function isValidSeed(raw: string): Promise<boolean> {
  const n = normalizeOnionUrl(raw);
  return n.ok;
}

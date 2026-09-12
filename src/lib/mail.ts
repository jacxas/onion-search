// FARO — alertas por email (nodemailer, Gmail App Password o SMTP genérico)
// con throttle persistente para no repetir alertas de hosts inestables.

import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "../db";
import { alertsLog } from "../db/schema";
import { getConfig } from "./config";

const THROTTLE_HOURS = 12;

export type AlertKind = "offline" | "recovered" | "block" | "report";

export function mailEnabled(): boolean {
  return getConfig().mail !== null;
}

/** true si pasó el throttle desde la última alerta de este kind+key. */
async function shouldSend(kind: AlertKind, key: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - THROTTLE_HOURS * 3_600_000);
  const res = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(alertsLog)
    .where(and(eq(alertsLog.kind, kind), eq(alertsLog.key, key.slice(0, 255)), gt(alertsLog.sentAt, cutoff)));
  return Number(res[0]?.n ?? 0) === 0;
}

async function recordSent(kind: AlertKind, key: string): Promise<void> {
  await db().insert(alertsLog).values({ kind, key: key.slice(0, 255) });
}

/** Envía un mail de alerta si está configurado y no está throttled. */
export async function sendAlert(kind: AlertKind, key: string, subject: string, text: string): Promise<boolean> {
  const cfg = getConfig();
  if (!cfg.mail) return false;
  if (!(await shouldSend(kind, key))) return false;
  try {
    const nodemailer = await import("nodemailer");
    const m = cfg.mail;
    const transporter = m.service === "gmail"
      ? nodemailer.createTransport({ service: "gmail", auth: { user: m.username, pass: m.password } })
      : nodemailer.createTransport({ host: m.host, port: m.port, secure: m.port === 465, auth: { user: m.username, pass: m.password } });
    await transporter.sendMail({
      from: m.username,
      to: m.alertTo,
      subject: `[FARO] ${subject}`,
      text,
    });
    await recordSent(kind, key);
    return true;
  } catch (e) {
    console.error("mail error:", e instanceof Error ? e.message : e);
    return false;
  }
}

/** Alertas por transición de salud (offline/recovered). */
export async function alertTransitions(transitions: { domain: string; from: boolean; to: boolean }[]): Promise<void> {
  for (const t of transitions) {
    if (t.to) {
      await sendAlert("recovered", t.domain, `Recuperado: ${t.domain}`, `${t.domain} vuelve a estar en línea.`);
    } else {
      await sendAlert("offline", t.domain, `Caído: ${t.domain}`, `${t.domain} pasó de en línea a offline.`);
    }
  }
}

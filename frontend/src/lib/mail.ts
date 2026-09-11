import nodemailer, { type Transporter } from "nodemailer";

/**
 * Alertas por email del pipeline.
 * Config:
 *   MAIL_USERNAME / MAIL_PASSWORD  → SMTP (Gmail: user + App Password)
 *   MAIL_ALERT_TO                  → destinatario (default: ADMIN_INITIAL_EMAIL)
 *   MAIL_HOST / MAIL_PORT          → SMTP genérico (default: service gmail)
 *
 * Sin credenciales configuradas, sendAlert es un no-op silencioso.
 */

let transporter: Transporter | null | undefined;

const MAIL_ALERT_TO =
  process.env.MAIL_ALERT_TO ?? process.env.ADMIN_INITIAL_EMAIL ?? null;

function getTransporter(): Transporter | null {
  if (transporter !== undefined) return transporter;

  const user = process.env.MAIL_USERNAME;
  const pass = process.env.MAIL_PASSWORD;
  if (!user || !pass || !MAIL_ALERT_TO) {
    transporter = null;
    return null;
  }

  const host = process.env.MAIL_HOST;
  transporter = host
    ? nodemailer.createTransport({
        host,
        port: Number(process.env.MAIL_PORT ?? 587),
        secure: Number(process.env.MAIL_PORT ?? 587) === 465,
        auth: { user, pass },
      })
    : nodemailer.createTransport({ service: "gmail", auth: { user, pass } });

  return transporter;
}

export function mailEnabled(): boolean {
  return getTransporter() !== null;
}

export interface AlertPayload {
  subject: string;
  text: string;
}

/** Envía una alerta al operador. Nunca lanza: falla queda en consola. */
export async function sendAlert({ subject, text }: AlertPayload): Promise<boolean> {
  const t = getTransporter();
  if (!t || !MAIL_ALERT_TO) return false;
  try {
    await t.sendMail({
      from: `FARO <${process.env.MAIL_USERNAME}>`,
      to: MAIL_ALERT_TO,
      subject: `[FARO] ${subject}`,
      text: `${text}\n\n—\nFARO · buscador .onion\n${new Date().toISOString()}`,
    });
    return true;
  } catch (e) {
    console.error("[mail] fallo el envío:", e instanceof Error ? e.message : e);
    return false;
  }
}

/** Throttle simple por clave: no repetir la misma alerta antes de N minutos. */
const lastSent = new Map<string, number>();

export async function sendThrottledAlert(
  key: string,
  minMinutes: number,
  payload: AlertPayload,
): Promise<boolean> {
  const now = Date.now();
  const last = lastSent.get(key) ?? 0;
  if (now - last < minMinutes * 60_000) return false;
  const sent = await sendAlert(payload);
  if (sent) lastSent.set(key, now);
  return sent;
}

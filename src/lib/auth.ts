// FARO — auth admin: scrypt + sesiones (token 256 bits, DB guarda solo hash
// SHA-256), rate-limit de login 6/10min por email, CSRF same-origin,
// admin authorization (sesión o ADMIN_TOKEN server-to-server).

import { cookies } from "next/headers";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { adminUsers, loginAttempts, sessions } from "../db/schema";
import { getConfig } from "./config";
import { randomToken, sha256Hex } from "./onion";

const COOKIE = "faro_session";
const SESSION_DAYS = 7;
const RATE_WINDOW_MIN = 10;
const RATE_MAX = 6;

// ── scrypt ─────────────────────────────────────────────────────────────────

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expect = Buffer.from(hash, "hex");
  const got = scryptSync(password, salt, expect.length);
  return expect.length === got.length && timingSafeEqual(expect, got);
}

// ── sesiones ────────────────────────────────────────────────────────────────

export interface SessionUser {
  id: number;
  email: string;
}

/** Crea admin inicial desde config si la tabla está vacía (idempotente). */
export async function ensureInitialAdmin(): Promise<void> {
  const cfg = getConfig();
  const d = db();
  const res = await d.select({ n: sql<number>`count(*)::int` }).from(adminUsers);
  if (Number(res[0]?.n ?? 0) === 0) {
    await d.insert(adminUsers).values({ email: cfg.adminInitialEmail, passwordHash: hashPassword(cfg.adminInitialPassword) })
      .onConflictDoNothing();
  }
}

export async function createSession(userId: number, ip: string | null, userAgent: string | null): Promise<void> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db().insert(sessions).values({
    tokenHash: sha256Hex(token),
    adminUserId: userId,
    ip: ip?.slice(0, 64) ?? null,
    userAgent: userAgent?.slice(0, 300) ?? null,
    expiresAt,
  });
  // limpieza oportunista de sesiones vencidas
  await db().delete(sessions).where(lt(sessions.expiresAt, new Date()));
  const jar = await cookies();
  jar.set({
    name: COOKIE,
    value: token,
    httpOnly: true,
    secure: getConfig().secureCookies,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const rows = await db()
    .select({ id: adminUsers.id, email: adminUsers.email })
    .from(sessions)
    .innerJoin(adminUsers, eq(adminUsers.id, sessions.adminUserId))
    .where(and(eq(sessions.tokenHash, sha256Hex(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return rows[0] ?? null;
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await db().delete(sessions).where(eq(sessions.tokenHash, sha256Hex(token)));
  jar.delete(COOKIE);
}

// ── login con rate-limit ───────────────────────────────────────────────────

export async function loginRateLimited(email: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - RATE_WINDOW_MIN * 60_000);
  const res = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.email, email), gt(loginAttempts.at, cutoff)));
  return Number(res[0]?.n ?? 0) >= RATE_MAX;
}

export async function recordLoginAttempt(email: string, ip: string | null, success: boolean): Promise<void> {
  if (success) {
    await db().delete(loginAttempts).where(eq(loginAttempts.email, email));
  } else {
    await db().insert(loginAttempts).values({ email, ip: ip?.slice(0, 64) ?? null });
  }
}

/** Login completo: rate-limit → verify → sesión. */
export async function attemptLogin(email: string, password: string, ip: string | null, ua: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const clean = email.trim().toLowerCase();
  await ensureInitialAdmin();
  if (await loginRateLimited(clean)) return { ok: false, error: "rate_limited" };
  const rows = await db().select().from(adminUsers).where(eq(adminUsers.email, clean)).limit(1);
  const user = rows[0];
  const valid = user ? verifyPassword(password, user.passwordHash) : false;
  await recordLoginAttempt(clean, ip, valid);
  if (!valid || !user) return { ok: false, error: "bad_credentials" };
  await createSession(user.id, ip, ua);
  return { ok: true };
}

/** Cambio de clave: invalida las demás sesiones del usuario. */
export async function changePassword(userId: number, newPassword: string): Promise<void> {
  const hash = hashPassword(newPassword);
  await db().update(adminUsers).set({ passwordHash: hash, passwordChangedAt: new Date(), updatedAt: new Date() })
    .where(eq(adminUsers.id, userId));
  await db().delete(sessions).where(eq(sessions.adminUserId, userId));
}

// ── CSRF + autorización de API ─────────────────────────────────────────────

/** Validación Origin same-origin para endpoints autenticados por cookie. */
export function sameOrigin(req: Request): boolean {
  const cfg = getConfig();
  if (!cfg.csrfEnabled) return true;
  const origin = req.headers.get("origin");
  if (!origin) return false; // sin Origin no hay CSRF viable con sameSite=lax
  try {
    const o = new URL(origin);
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
    return o.host === host;
  } catch {
    return false;
  }
}

export interface AdminAuthResult {
  ok: true;
  via: "session" | "token";
  user?: SessionUser;
}

/** Admin por sesión (cookie) o ADMIN_TOKEN (server-to-server). */
export async function requireAdmin(req: Request): Promise<AdminAuthResult | { ok: false; error: string }> {
  const cfg = getConfig();
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? req.headers.get("x-admin-token");
  if (cfg.adminToken && bearer && timingSafeEqualSafe(bearer, cfg.adminToken)) {
    return { ok: true, via: "token" };
  }
  const user = await getSessionUser();
  if (user) {
    if (!sameOrigin(req)) return { ok: false, error: "csrf" };
    return { ok: true, via: "session", user };
  }
  return { ok: false, error: "unauthorized" };
}

function timingSafeEqualSafe(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

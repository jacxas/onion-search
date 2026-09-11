import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt, lt } from "drizzle-orm";
import { db } from "@/db";
import { adminSessions, adminUsers } from "@/db/schema";
import { recordEvent } from "@/lib/crawler/pipeline";

export const SESSION_COOKIE = "faro_session";
const SESSION_DAYS = 7;
const SECURE_COOKIES = (process.env.SECURE_COOKIES ?? "false").toLowerCase() === "true";

// ── contraseñas (scrypt nativo de Node, sin deps externas) ──────────────

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

// ── rate limiting de login (en memoria, por email) ──────────────────────

const attempts = new Map<string, number[]>();
const MAX_TRIES = 6;
const WINDOW_MS = 10 * 60 * 1000;

function rateLimited(key: string): boolean {
  const now = Date.now();
  const list = (attempts.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  attempts.set(key, list);
  return list.length >= MAX_TRIES;
}
function noteFailure(key: string) {
  const list = attempts.get(key) ?? [];
  list.push(Date.now());
  attempts.set(key, list);
}
function clearFailures(key: string) {
  attempts.delete(key);
}

// ── admin inicial ────────────────────────────────────────────────────────

export async function ensureInitialAdmin(): Promise<void> {
  const rows = await db.select({ id: adminUsers.id }).from(adminUsers).limit(1);
  if (rows.length > 0) return;

  const email = (process.env.ADMIN_INITIAL_EMAIL ?? "admin@faro.local").trim().toLowerCase();
  const password = process.env.ADMIN_INITIAL_PASSWORD ?? "faro-admin-123";
  await db
    .insert(adminUsers)
    .values({ email, passwordHash: hashPassword(password) })
    .onConflictDoNothing();
  await recordEvent(
    "system",
    `Admin inicial creado (${email})${process.env.ADMIN_INITIAL_PASSWORD ? "" : " — clave por defecto, CAMBIARLA"}`,
  );
}

// ── sesiones ─────────────────────────────────────────────────────────────

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface SessionInfo {
  userId: number;
  email: string;
}

export async function createSession(userId: number): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(adminSessions).values({ tokenHash: hashToken(token), userId, expiresAt });
  return token;
}

export async function getSession(): Promise<SessionInfo | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const now = new Date();
  const rows = await db
    .select({
      userId: adminSessions.userId,
      email: adminUsers.email,
      expiresAt: adminSessions.expiresAt,
    })
    .from(adminSessions)
    .innerJoin(adminUsers, eq(adminSessions.userId, adminUsers.id))
    .where(and(eq(adminSessions.tokenHash, hashToken(token)), gt(adminSessions.expiresAt, now)))
    .limit(1);

  if (rows.length === 0) return null;
  // limpieza perezosa de sesiones vencidas
  await db.delete(adminSessions).where(lt(adminSessions.expiresAt, now));
  return { userId: rows[0].userId, email: rows[0].email };
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.delete(adminSessions).where(eq(adminSessions.tokenHash, hashToken(token)));
  }
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: SECURE_COOKIES,
    path: "/",
    expires: expiresAt,
  };
}

// ── flujo de login ───────────────────────────────────────────────────────

export type LoginResult =
  | { ok: true; token: string }
  | { ok: false; error: string };

export async function tryLogin(email: string, password: string): Promise<LoginResult> {
  const key = email.trim().toLowerCase();
  if (rateLimited(key)) {
    return { ok: false, error: "Demasiados intentos. Esperá 10 minutos." };
  }

  await ensureInitialAdmin();
  const rows = await db
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.email, key))
    .limit(1);

  const user = rows[0];
  if (!user || !verifyPassword(password, user.passwordHash)) {
    noteFailure(key);
    return { ok: false, error: "Credenciales inválidas" };
  }

  clearFailures(key);
  await db.update(adminUsers).set({ lastLoginAt: new Date() }).where(eq(adminUsers.id, user.id));
  await recordEvent("system", `Login admin: ${user.email}`);
  return { ok: true, token: await createSession(user.id) };
}

/** Guard para páginas/acciones admin: exige sesión o redirige a /login. */
export async function requireAdmin(): Promise<SessionInfo> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

/** Cambio de contraseña del admin actual. */
export async function changePassword(userId: number, current: string, next: string): Promise<boolean> {
  const rows = await db.select().from(adminUsers).where(eq(adminUsers.id, userId)).limit(1);
  if (!rows[0] || !verifyPassword(current, rows[0].passwordHash)) return false;
  await db.update(adminUsers).set({ passwordHash: hashPassword(next) }).where(eq(adminUsers.id, userId));
  await db.delete(adminSessions).where(eq(adminSessions.userId, userId)); // cierra otras sesiones
  return true;
}

"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  SESSION_COOKIE,
  destroySession,
  sessionCookieOptions,
  tryLogin,
} from "@/lib/auth";

export type LoginFormResult = { ok: boolean; error?: string };

export async function loginAction(formData: FormData): Promise<LoginFormResult> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { ok: false, error: "Completá email y contraseña" };

  const r = await tryLogin(email, password);
  if (!r.ok) return { ok: false, error: r.error };

  const store = await cookies();
  store.set(
    SESSION_COOKIE,
    r.token,
    sessionCookieOptions(new Date(Date.now() + 7 * 86_400_000)),
  );
  return { ok: true };
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/login");
}

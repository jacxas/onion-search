import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { attemptLogin, getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  if (await getSessionUser()) redirect("/ops");

  async function login(formData: FormData): Promise<void> {
    "use server";
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const ua = h.get("user-agent");
    let res: Awaited<ReturnType<typeof attemptLogin>>;
    try {
      res = await attemptLogin(email, password, ip, ua);
    } catch {
      redirect("/login?error=bootstrap");
    }
    if (res.ok) redirect("/ops");
    redirect(`/login?error=${encodeURIComponent(res.error)}`);
  }

  const msg =
    error === "rate_limited" ? "demasiados intentos — esperá 10 minutos"
    : error === "bad_credentials" ? "email o contraseña incorrectos"
    : error === "bootstrap" ? "falta configurar el admin inicial (ADMIN_INITIAL_EMAIL/PASSWORD)"
    : error ? "error de acceso"
    : "";

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <h1 className="mb-6 text-center text-2xl font-bold tracking-widest text-green-400">FARO · acceso admin</h1>
      {msg && <p className="mb-4 rounded border border-red-900 bg-red-950/40 px-3 py-2 text-center text-sm text-red-400">{msg}</p>}
      <form action={login} className="space-y-3">
        <input
          name="email" type="email" required placeholder="admin@faro.local"
          className="w-full rounded border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-green-700"
        />
        <input
          name="password" type="password" required placeholder="contraseña"
          className="w-full rounded border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-green-700"
        />
        <button type="submit" className="w-full rounded border border-green-800 bg-green-900/30 px-4 py-2 text-sm text-green-400 hover:bg-green-900/50">
          entrar
        </button>
      </form>
    </main>
  );
}

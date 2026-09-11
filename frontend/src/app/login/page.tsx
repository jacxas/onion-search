import { redirect } from "next/navigation";
import { Lock, Radar } from "lucide-react";
import { ensureInitialAdmin, getSession } from "@/lib/auth";
import { LoginForm } from "@/components/login-form";

export const dynamic = "force-dynamic";

export const metadata = { title: "FARO — acceso admin" };

export default async function LoginPage() {
  await ensureInitialAdmin().catch(() => undefined);
  const s = await getSession().catch(() => null);
  if (s) redirect("/ops");

  return (
    <div className="flex min-h-[75dvh] items-center justify-center pt-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Radar size={36} className="glow mx-auto text-accent" strokeWidth={1.5} />
          <h1 className="glow-soft font-display mt-4 text-2xl font-bold tracking-[0.2em] text-ink">
            ACCESO ADMIN
          </h1>
          <p className="mt-2 text-xs text-dim">
            panel de operaciones · conexión encriptada extremo a extremo
          </p>
        </div>

        <div className="card-panel p-6">
          <div className="mb-4 flex items-center gap-2 text-[10px] tracking-[0.25em] text-faint uppercase">
            <Lock size={11} className="text-accent" /> credenciales
          </div>
          <LoginForm />
        </div>

        <p className="mt-6 text-center text-[10px] leading-relaxed text-faint">
          primer arranque: usá las credenciales de ADMIN_INITIAL_* del .env
          <br />
          (o admin@faro.local / faro-admin-123 si no las definiste) y cambialas después.
        </p>
      </div>
    </div>
  );
}

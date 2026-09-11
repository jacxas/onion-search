"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogIn } from "lucide-react";
import { loginAction } from "@/app/login/actions";

export function LoginForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setError(null);
        start(async () => {
          const r = await loginAction(fd);
          if (r.ok) {
            router.push("/ops");
            router.refresh();
          } else {
            setError(r.error ?? "Error de autenticación");
          }
        });
      }}
    >
      <input
        name="email"
        type="email"
        className="field"
        placeholder="admin@…"
        autoComplete="username"
        required
      />
      <input
        name="password"
        type="password"
        className="field"
        placeholder="contraseña"
        autoComplete="current-password"
        required
      />
      <button className="btn btn-primary w-full justify-center" disabled={pending}>
        {pending ? <Loader2 size={14} className="animate-spin" /> : <LogIn size={14} />}
        ingresar
      </button>
      {error && <p className="text-center text-[11px] text-red">{error}</p>}
    </form>
  );
}

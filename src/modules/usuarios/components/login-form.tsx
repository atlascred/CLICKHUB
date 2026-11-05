"use client";

import { apiErrorMessage, fetchApi } from "@/lib/client-api";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Eye, EyeOff, LoaderCircle, Lock, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { navigationItems } from "@/config/navigation";
import type { ApiResult } from "@/types/api";

type LoginResult = {
  role?: "ADMIN" | "EMPLOYEE";
  permissions?: Record<string, boolean> | null;
};

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const formData = new FormData(event.currentTarget);

    try {
      const response = await fetchApi("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: formData.get("email"),
        password: formData.get("password"),
      }),
    });
    const result = (await response.json()) as ApiResult<LoginResult>;

    if (result.status === "success") {
      router.replace(safeRedirectPath(searchParams.get("redirect"), getStartPath(result.data)));
      router.refresh();
      return;
    }

      setError(result.message);
    } catch (error) {
      setError(apiErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit} aria-busy={loading}>
      <label className="block space-y-2">
        <span className="text-sm font-medium">E-mail</span>
        <div className="relative">
          <Mail className="pointer-events-none absolute left-4 top-4 h-4 w-4 text-slate-400" />
          <Input
            className="h-12 rounded-xl border-slate-200 bg-slate-50/70 pl-11 text-base text-slate-950 placeholder:text-slate-400 focus-visible:ring-blue-600"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            name="email"
            placeholder="usuario@clickhub.com.br"
            required
            type="email"
          />
        </div>
      </label>
      <label className="block space-y-2">
        <span className="text-sm font-medium">Senha</span>
        <div className="relative">
          <Lock className="pointer-events-none absolute left-4 top-4 h-4 w-4 text-slate-400" />
          <Input
            className="h-12 rounded-xl border-slate-200 bg-slate-50/70 pl-11 pr-12 text-base text-slate-950 placeholder:text-slate-400 focus-visible:ring-blue-600"
            autoComplete="current-password"
            name="password"
            placeholder="Digite sua senha"
            required
            type={showPassword ? "text" : "password"}
          />
          <button
            aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
            aria-pressed={showPassword}
            className="absolute right-0.5 top-0.5 grid h-11 w-11 place-items-center rounded-lg text-slate-500 hover:text-blue-700"
            onClick={() => setShowPassword((current) => !current)}
            type="button"
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </label>
      {error ? <p role="alert" className="rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      <Button className="h-12 w-full justify-between rounded-xl bg-blue-600 px-5 font-semibold text-white shadow-lg shadow-blue-600/15 hover:bg-blue-700" disabled={loading} type="submit">
        {loading ? "Entrando..." : "Entrar na plataforma"}
        {loading ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <ArrowRight className="h-4 w-4" />}
      </Button>
    </form>
  );
}

function getStartPath(user?: LoginResult) {
  if (user?.role === "ADMIN") {
    return "/dashboard";
  }

  const item = navigationItems.find((navigationItem) => {
    if ("adminOnly" in navigationItem && navigationItem.adminOnly) return false;
    if ("employeeVisible" in navigationItem && navigationItem.employeeVisible) return true;
    return Boolean(user?.permissions?.[navigationItem.permission]);
  });

  return item?.href ?? "/configuracoes";
}

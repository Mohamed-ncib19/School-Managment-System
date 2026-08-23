"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { useMutation } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff } from "lucide-react";
import { authApi } from "@/lib/api/auth.api";
import { useAuthStore } from "@/hooks/use-auth-store";
import { FormButton } from "@/components/forms/form-helpers";
import RestoreFlow from "@/components/auth/restore-flow";
import { useTranslation } from "@/lib/i18n/context";
import { useSystemSettings } from "@/hooks/use-system-settings";
import { LoginSkeleton } from "@/components/shared/skeletons";

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

export default function LoginPage() {
  const router = useRouter();
  const { setSession, status, hydrate } = useAuthStore();
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslation();

  // A visitor with a live session cookie (browser Back from the dashboard, a
  // stale tab, a refresh on /login) must never land on the form: restore the
  // identity and send them straight back. The middleware does the same check
  // server-side before this even renders.
  useEffect(() => {
    if (status === "loading") void hydrate();
    if (status === "authenticated") router.replace("/dashboard");
  }, [status, router, hydrate]);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
  });

  const { data: system, isLoading: systemLoading } = useSystemSettings();
  const systemName = system?.system_name?.trim() || t("app.name");

  const mutation = useMutation({
    mutationFn: authApi.login,
    onSuccess: (data) => {
      // The access token lives in an httpOnly cookie; only the identity is
      // kept in memory.
      setSession(data.user);
      router.push("/dashboard");
    },
    onError: () => {
      setError(t("auth.invalidCredentials"));
    },
  });

  const onSubmit = (data: z.infer<typeof loginSchema>) => mutation.mutate(data);

  if (systemLoading) {
    return <LoginSkeleton />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary via-primary-700 to-primary-900 p-4">
      <div className="w-full max-w-sm">
        <div className="bg-surface rounded-modal shadow-hover p-8">
          <div className="flex flex-col items-center mb-8">
            <div className="h-14 w-14 rounded-card bg-primary flex items-center justify-center mb-4 shadow-md">
              <span className="text-white text-xl font-bold tracking-tight">{systemName.split(" ").map(w => w[0]).join("").slice(0,2)}</span>
            </div>
            <h1 className="text-h2 font-bold text-text-primary">{systemName}</h1>
            <p className="text-sm text-text-secondary">{t("app.tagline")}</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-input px-4 py-3 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-red-500 shrink-0" />
                {error}
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-text-primary mb-1.5">{t("auth.email")}</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder={t("auth.enterEmail")}
                className={`input ${errors.email ? "input-error" : ""}`}
                {...register("email")}
              />
              {errors.email && <p className="text-xs text-red-500 mt-1">{t("auth.enterEmail")}</p>}
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-text-primary mb-1.5">{t("auth.password")}</label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder={t("auth.enterPasswordPlaceholder")}
                  className={`input pr-10 ${errors.password ? "input-error" : ""}`}
                  {...register("password")}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary transition-colors"
                  aria-label={showPassword ? t("auth.hidePassword") : t("auth.showPassword")}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {errors.password && <p className="text-xs text-red-500 mt-1">{t("auth.enterPassword")}</p>}
            </div>

          <FormButton type="submit" isLoading={isSubmitting} className="w-full">
            {t("auth.signIn")}
          </FormButton>
          </form>
          <RestoreFlow />
      </div>
      </div>
    </div>
  );
}

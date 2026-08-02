"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ChevronRight, User, Lock, Globe, Save, Eye, EyeOff, Database, Download, RefreshCw, Trash2, Calendar, Network, ImagePlus, Upload } from "lucide-react";
import { usersApi } from "@/lib/api/users.api";
import { authApi } from "@/lib/api/auth.api";
import { useAuthStore } from "@/hooks/use-auth-store";
import { useTranslation } from "@/lib/i18n/context";
import { FormButton } from "@/components/forms/form-helpers";
import { useBackups, useCreateBackup, useRestoreBackup } from "@/hooks/use-backups";
import { useFinancialSettings, useUploadLogo, useRemoveLogo } from "@/hooks/use-financial";
import { apiBaseUrl } from "@/lib/api/client";

const profileSchema = z.object({
  full_name: z.string().min(1, "Name is required"),
  email: z.string().email("Enter a valid email"),
});

const passwordSchema = z.object({
  current_password: z.string().min(1, "Current password is required"),
  new_password: z.string().min(6, "Password must be at least 6 characters"),
  confirm_password: z.string().min(1, "Please confirm your password"),
}).refine((data) => data.new_password === data.confirm_password, {
  message: "Passwords don't match",
  path: ["confirm_password"],
});

type ProfileForm = z.infer<typeof profileSchema>;
type PasswordForm = z.infer<typeof passwordSchema>;

export default function SettingsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { user, setAuth } = useAuthStore();
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPasswords, setShowPasswords] = useState(false);
  const [backupVersion, setBackupVersion] = useState("");
  const [restoreConfirm, setRestoreConfirm] = useState("");
  const [selectedRestoreId, setSelectedRestoreId] = useState<string | null>(null);

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["users", "me"],
    queryFn: usersApi.me,
  });

const { data: backups, isLoading: backupsLoading } = useBackups();
const createBackupMutation = useCreateBackup();
const restoreBackupMutation = useRestoreBackup();

const { data: settings } = useFinancialSettings();
const uploadLogo = useUploadLogo();
const removeLogo = useRemoveLogo();
const fileInputRef = useRef<HTMLInputElement>(null);

const logoUrl = settings?.logo_path
  ? `${apiBaseUrl()}/financial/settings/logo?v=${new Date(settings.updated_at).getTime()}`
  : null;

const profileForm = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    values: {
      full_name: profile?.full_name ?? user?.full_name ?? "",
      email: profile?.email ?? user?.email ?? "",
    },
  });

  const passwordForm = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
  });

  useEffect(() => {
    if (profile) {
      profileForm.reset({
        full_name: profile.full_name,
        email: profile.email,
      });
    }
  }, [profile, profileForm]);

  const updateProfileMutation = useMutation({
    mutationFn: (data: ProfileForm) => usersApi.updateProfile(data),
    onSuccess: (data) => {
      setAuth(useAuthStore.getState().token!, data);
      queryClient.invalidateQueries({ queryKey: ["users", "me"] });
      setSuccess(t("settings.profileUpdated"));
      setError(null);
      setTimeout(() => setSuccess(null), 3000);
    },
    onError: () => {
      setError("Failed to update profile");
      setSuccess(null);
    },
  });

  const changePasswordMutation = useMutation({
    mutationFn: (data: PasswordForm) =>
      authApi.changePassword(data.current_password, data.new_password),
    onSuccess: () => {
      passwordForm.reset();
      setSuccess(t("settings.passwordChanged"));
      setError(null);
      setTimeout(() => setSuccess(null), 3000);
    },
    onError: () => {
      setError("Failed to change password");
      setSuccess(null);
    },
  });

  const onProfileSubmit = (data: ProfileForm) => {
    updateProfileMutation.mutate(data);
  };

  const onPasswordSubmit = (data: PasswordForm) => {
    changePasswordMutation.mutate(data);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-text-secondary">
        <Link href="/dashboard" className="hover:text-primary">{t("nav.dashboard")}</Link>
        <ChevronRight size={14} />
        <span className="text-text-primary font-medium">{t("settings.title")}</span>
      </div>

      <div>
        <h2 className="text-h4 font-bold text-text-primary">{t("settings.title")}</h2>
        <p className="text-xs text-text-secondary">{t("settings.subtitle")}</p>
      </div>

      {success && (
        <div className="bg-success-soft dark:bg-success-dark-soft border border-success/20 dark:border-success-dark/20 text-success-strong dark:text-success-dark-strong text-sm rounded-input px-4 py-3 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-success dark:bg-success-dark shrink-0" />
          {success}
        </div>
      )}

      {error && (
        <div className="bg-danger-soft dark:bg-danger-dark-soft border border-danger/20 dark:border-danger-dark/20 text-danger-strong dark:text-danger-dark-strong text-sm rounded-input px-4 py-3 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-danger dark:bg-danger-dark shrink-0" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Branding Section */}
        <div className="xl:col-span-2">
          <div className="card">
            <div className="flex items-center gap-3 mb-6">
              <div className="h-10 w-10 rounded-card bg-primary-50 dark:bg-primary/15 flex items-center justify-center text-primary">
                <ImagePlus size={20} />
              </div>
              <div>
                <h3 className="text-h4 font-bold text-text-primary">{t("settings.brandingTitle", "Branding")}</h3>
                <p className="text-xs text-text-secondary">{t("settings.brandingDescription", "Upload a logo used in printable documents, the sidebar, and as the browser favicon.")}</p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="h-20 w-20 shrink-0 rounded-btn border border-border bg-background flex items-center justify-center overflow-hidden">
                {logoUrl ? (
                  <img src={logoUrl} alt={settings?.academy_name ?? "Academy"} className="h-full w-full object-contain" />
                ) : (
                  <ImagePlus size={24} className="text-text-secondary" />
                )}
              </div>

              <div className="flex-1 space-y-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setError(null);
                    uploadLogo.mutate(file, {
                      onError: (err) => setError((err as Error)?.message || t("common.somethingWentWrong", "Something went wrong")),
                    });
                    e.target.value = "";
                  }}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadLogo.isPending}
                    className="btn btn-primary text-xs"
                  >
                    {uploadLogo.isPending ? <Upload size={13} className="animate-pulse" aria-hidden="true" /> : <Upload size={13} aria-hidden="true" />}
                    {uploadLogo.isPending
                      ? t("settings.uploading", "Uploading…")
                      : t("settings.uploadLogo", "Upload logo")}
                  </button>
                  {logoUrl && (
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        removeLogo.mutate(undefined, {
                          onError: (err) => setError((err as Error)?.message || t("common.somethingWentWrong", "Something went wrong")),
                        });
                      }}
                      disabled={removeLogo.isPending}
                      className="btn btn-secondary text-xs"
                    >
                      <Trash2 size={13} aria-hidden="true" />
                      {t("settings.removeLogo", "Remove")}
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-text-secondary">
                  {t("settings.logoFormat", "PNG, JPG or WebP — up to 2 MB. The file is served from the backend; the old one is deleted on replace.")}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Profile Section */}
        <div className="xl:col-span-2 space-y-6">
          <div className="card">
            <div className="flex items-center gap-3 mb-6">
              <div className="h-10 w-10 rounded-card bg-primary-50 dark:bg-primary/15 flex items-center justify-center text-primary">
                <User size={20} />
              </div>
              <div>
                <h3 className="text-h4 font-bold text-text-primary">{t("settings.profileTitle")}</h3>
                <p className="text-xs text-text-secondary">{t("settings.profileDescription")}</p>
              </div>
            </div>

            <form onSubmit={profileForm.handleSubmit(onProfileSubmit)} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="full_name" className="block text-sm font-medium text-text-primary mb-1.5">
                    {t("settings.firstName")}
                  </label>
                  <input
                    id="full_name"
                    type="text"
                    className={`input w-full ${profileForm.formState.errors.full_name ? "input-error" : ""}`}
                    {...profileForm.register("full_name")}
                  />
                  {profileForm.formState.errors.full_name && (
                    <p className="text-xs text-danger dark:text-danger-dark mt-1">{profileForm.formState.errors.full_name.message}</p>
                  )}
                </div>
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-text-primary mb-1.5">
                    {t("settings.email")}
                  </label>
                  <input
                    id="email"
                    type="email"
                    className={`input w-full ${profileForm.formState.errors.email ? "input-error" : ""}`}
                    {...profileForm.register("email")}
                  />
                  {profileForm.formState.errors.email && (
                    <p className="text-xs text-danger dark:text-danger-dark mt-1">{profileForm.formState.errors.email.message}</p>
                  )}
                </div>
              </div>

              <div className="flex justify-end">
                <FormButton type="submit" isLoading={updateProfileMutation.isPending} className="btn btn-primary text-xs">
                  <Save size={14} /> {t("settings.saveChanges")}
                </FormButton>
              </div>
            </form>
          </div>

          {/* Change Password */}
          <div className="card">
            <div className="flex items-center gap-3 mb-6">
              <div className="h-10 w-10 rounded-card bg-primary-50 dark:bg-primary/15 flex items-center justify-center text-primary">
                <Lock size={20} />
              </div>
              <div>
                <h3 className="text-h4 font-bold text-text-primary">{t("settings.securityTitle")}</h3>
                <p className="text-xs text-text-secondary">{t("settings.securityDescription")}</p>
              </div>
            </div>

            <form onSubmit={passwordForm.handleSubmit(onPasswordSubmit)} className="space-y-4">
              <div>
                <label htmlFor="current_password" className="block text-sm font-medium text-text-primary mb-1.5">
                  {t("settings.currentPassword")}
                </label>
                <div className="relative">
                  <input
                    id="current_password"
                    type={showPasswords ? "text" : "password"}
                    className={`input w-full pr-10 ${passwordForm.formState.errors.current_password ? "input-error" : ""}`}
                    {...passwordForm.register("current_password")}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPasswords(!showPasswords)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary transition-colors"
                    aria-label={showPasswords ? "Hide password" : "Show password"}
                  >
                    {showPasswords ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {passwordForm.formState.errors.current_password && (
                  <p className="text-xs text-danger dark:text-danger-dark mt-1">{passwordForm.formState.errors.current_password.message}</p>
                )}
              </div>

              <div>
                <label htmlFor="new_password" className="block text-sm font-medium text-text-primary mb-1.5">
                  {t("settings.newPassword")}
                </label>
                <div className="relative">
                  <input
                    id="new_password"
                    type={showPasswords ? "text" : "password"}
                    className={`input w-full pr-10 ${passwordForm.formState.errors.new_password ? "input-error" : ""}`}
                    {...passwordForm.register("new_password")}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPasswords(!showPasswords)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary transition-colors"
                    aria-label={showPasswords ? "Hide password" : "Show password"}
                  >
                    {showPasswords ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {passwordForm.formState.errors.new_password && (
                  <p className="text-xs text-danger dark:text-danger-dark mt-1">{passwordForm.formState.errors.new_password.message}</p>
                )}
              </div>

              <div>
                <label htmlFor="confirm_password" className="block text-sm font-medium text-text-primary mb-1.5">
                  {t("settings.confirmPassword")}
                </label>
                <div className="relative">
                  <input
                    id="confirm_password"
                    type={showPasswords ? "text" : "password"}
                    className={`input w-full pr-10 ${passwordForm.formState.errors.confirm_password ? "input-error" : ""}`}
                    {...passwordForm.register("confirm_password")}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPasswords(!showPasswords)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary transition-colors"
                    aria-label={showPasswords ? "Hide password" : "Show password"}
                  >
                    {showPasswords ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {passwordForm.formState.errors.confirm_password && (
                  <p className="text-xs text-danger dark:text-danger-dark mt-1">{passwordForm.formState.errors.confirm_password.message}</p>
                )}
              </div>

              <div className="flex justify-end">
                <FormButton type="submit" isLoading={changePasswordMutation.isPending} className="btn btn-primary text-xs">
                  <Save size={14} /> {t("settings.saveChanges")}
                </FormButton>
              </div>
            </form>
          </div>
        </div>

        {/* System Preferences Sidebar */}
        <div className="space-y-6">
          <div className="card">
            <div className="flex items-center gap-3 mb-6">
              <div className="h-10 w-10 rounded-card bg-primary-50 dark:bg-primary/15 flex items-center justify-center text-primary">
                <Globe size={20} />
              </div>
              <div>
                <h3 className="text-h4 font-bold text-text-primary">{t("settings.systemTitle")}</h3>
                <p className="text-xs text-text-secondary">{t("settings.systemDescription")}</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">{t("settings.language")}</label>
                <div className="flex gap-2">
                  {(["en", "fr"] as const).map((locale) => (
                    <LanguageOption key={locale} locale={locale} />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Account Info */}
          <div className="card">
            <h3 className="text-h4 font-bold text-text-primary mb-4">{t("settings.profileTitle")}</h3>
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-xs text-text-secondary">{t("settings.email")}</p>
                <p className="font-medium text-text-primary">{profile?.email ?? user?.email ?? "-"}</p>
              </div>
              <div>
                <p className="text-xs text-text-secondary">{t("settings.firstName")}</p>
                <p className="font-medium text-text-primary">{profile?.full_name ?? user?.full_name ?? "-"}</p>
              </div>
            </div>
          </div>

          {/* Navigation Hierarchy */}
          <div className="card">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-10 w-10 rounded-card bg-primary-50 dark:bg-primary/15 flex items-center justify-center text-primary">
                <Network size={20} />
              </div>
              <div>
                <h3 className="text-h4 font-bold text-text-primary">{t("hierarchy.title", "Navigation Hierarchy")}</h3>
                <p className="text-xs text-text-secondary">{t("hierarchy.subtitle", "Configure hierarchy navigation order")}</p>
              </div>
            </div>
            <Link
              href="/settings/hierarchy"
              className="btn btn-primary w-full text-xs"
            >
              <Network size={14} /> {t("hierarchy.builder", "Hierarchy Builder")}
            </Link>
          </div>

          {/* Backup & Restore */}
          <div className="card">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-10 w-10 rounded-card bg-primary-50 dark:bg-primary/15 flex items-center justify-center text-primary">
                <Database size={20} />
              </div>
              <div>
                <h3 className="text-h4 font-bold text-text-primary">{t("settings.backupTitle", "Database Backup")}</h3>
                <p className="text-xs text-text-secondary">{t("settings.backupDescription", "Create, list, and restore versioned database backups")}</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1.5">
                  {t("settings.backupVersionLabel", "Version Label")}
                </label>
                <input
                  type="text"
                  value={backupVersion}
                  onChange={(e) => setBackupVersion(e.target.value)}
                  placeholder={t("settings.backupVersionPlaceholder", "e.g. v1.0.0, before-migration")}
                  className="input w-full"
                />
              </div>

              <button
                onClick={() => {
                  setError(null);
                  setSuccess(null);
                  createBackupMutation.mutate(backupVersion || undefined);
                  setBackupVersion("");
                }}
                disabled={createBackupMutation.isPending}
                className="btn btn-primary w-full text-xs"
              >
                {createBackupMutation.isPending ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" />
                    {t("settings.backingUp", "Creating backup...")}
                  </>
                ) : (
                  <>
                    <Download size={14} />
                    {t("settings.createBackup", "Create Backup")}
                  </>
                )}
              </button>

              {createBackupMutation.isError && (
                <p className="text-xs text-danger">{createBackupMutation.error?.message || t("settings.backupFailed")}</p>
              )}
              {createBackupMutation.isSuccess && (
                <p className="text-xs text-success-strong">
                  {createBackupMutation.data?.message || t("settings.backupSuccess")}
                </p>
              )}

              <div>
                <h4 className="text-xs font-medium text-text-secondary uppercase mb-2">
                  {t("settings.existingBackups", "Existing Backups")}
                </h4>
                {backupsLoading ? (
                  <p className="text-xs text-text-secondary">{t("settings.loadingBackups", "Loading...")}</p>
                ) : backups && backups.length === 0 ? (
                  <p className="text-xs text-text-secondary">{t("settings.noBackups", "No backups yet")}</p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {backups?.map((b) => (
                      <div key={b.id} className="card p-3 flex items-center justify-between">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-text-primary truncate">
                            {b.version ? `${b.version}` : t("settings.unnamed", "Unnamed")}
                          </p>
                          <p className="text-xs text-text-secondary truncate">{b.filename}</p>
                          <div className="flex items-center gap-3 text-xs text-text-secondary mt-0.5">
                            <span>{Math.round(b.size / 1024)} KB</span>
                            <span className="flex items-center gap-1">
                              <Calendar size={10} />
                              {new Date(b.createdAt).toLocaleString()}
                            </span>
                          </div>
                        </div>
                        <button
                          onClick={() => setSelectedRestoreId(b.id)}
                          className="btn btn-danger text-xs h-8"
                        >
                          <RefreshCw size={12} />
                          {t("settings.restore", "Restore")}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {restoreBackupMutation.isError && (
                <p className="text-xs text-danger">{restoreBackupMutation.error?.message || t("settings.restoreFailed")}</p>
              )}
              {restoreBackupMutation.isSuccess && (
                <p className="text-xs text-success-strong">
                  {t("settings.restoreSuccess", "Backup restored successfully. The system has been updated.")}
                </p>
              )}
            </div>
          </div>

          {selectedRestoreId && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setRestoreConfirm("")}>
              <div className="bg-surface rounded-modal shadow-hover p-6 w-full max-w-md mx-4 border border-border" onClick={(e) => e.stopPropagation()}>
                <h3 className="text-h4 font-bold text-text-primary mb-4">
                  {t("settings.restoreConfirmTitle", "Confirm Restore")}
                </h3>
                <p className="text-sm text-text-secondary mb-4">
                  {t("settings.restoreConfirmDesc", "This will replace all current data with the backup. Type RESTORE below to confirm.")}
                </p>
                <input
                  type="text"
                  value={restoreConfirm}
                  onChange={(e) => setRestoreConfirm(e.target.value)}
                  placeholder="RESTORE"
                  className="input w-full mb-4"
                />
                <div className="flex gap-3 justify-end">
                  <button
                    onClick={() => { setRestoreConfirm(""); setSelectedRestoreId(null); }}
                    className="btn btn-secondary text-xs"
                  >
                    {t("fields.cancel")}
                  </button>
                  <button
                    onClick={() => {
                      if (restoreConfirm === "RESTORE" && selectedRestoreId) {
                        restoreBackupMutation.mutate(selectedRestoreId);
                        setSelectedRestoreId(null);
                        setRestoreConfirm("");
                      }
                    }}
                    disabled={restoreConfirm !== "RESTORE" || restoreBackupMutation.isPending}
                    className="btn btn-danger text-xs"
                  >
                    {restoreBackupMutation.isPending ? t("settings.restoring", "Restoring...") : t("settings.restore", "Restore")}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LanguageOption({ locale }: { locale: "en" | "fr" }) {
  const { locale: currentLocale, setLocale } = useTranslation();
  const isActive = currentLocale === locale;
  const labels: Record<string, string> = { en: "EN", fr: "FR" };

  return (
    <button
      onClick={() => setLocale(locale)}
      className={`flex-1 py-2 px-3 rounded-btn text-xs font-medium transition-colors ${
        isActive
          ? "bg-primary text-white shadow-sm"
          : "bg-background border border-border text-text-secondary hover:bg-neutral-soft"
      }`}
    >
      {labels[locale]}
    </button>
  );
}

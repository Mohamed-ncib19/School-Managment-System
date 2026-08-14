"use client";

import { useState, useEffect, useRef, Fragment } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  ChevronRight,
  User,
  Lock,
  Globe,
  Save,
  Eye,
  EyeOff,
  Database,
  Download,
  RefreshCw,
  Trash2,
  Calendar,
  Network,
  ImagePlus,
  Upload,
Palette,
  SunMoon,
  ToggleLeft,
  Users,
  UserCheck,
  ClipboardCheck,
  CircleDollarSign,
  UserCog,
  LayoutDashboard,
  Wallet,
  Layers,
  BookOpen,
  Settings,
  ChevronDown,
  TrendingUp,
  CheckCircle2,
  FileText,
  Receipt,
  SlidersHorizontal,
  Headset,
} from "lucide-react";
import { usersApi } from "@/lib/api/users.api";
import { authApi } from "@/lib/api/auth.api";
import { updatesApi } from "@/lib/api/updates.api";
import { useAuthStore } from "@/hooks/use-auth-store";
import { useUpdateStore } from "@/hooks/use-update-store";
import { useTranslation } from "@/lib/i18n/context";
import { FormButton } from "@/components/forms/form-helpers";
import { useBackups, useCreateBackup, useRestoreBackup } from "@/hooks/use-backups";
import { useFinancialSettings, useUploadLogo, useRemoveLogo } from "@/hooks/use-financial";
import { useSystemSettings, useUpdateSystemSettings, isFeatureEnabled, FEATURE_KEYS, type FeatureKey } from "@/hooks/use-system-settings";
import { useAppearance, ACCENT_PRESETS, ACCENT_IDS } from "@/hooks/use-appearance";
import { useHierarchyConfig, type HierarchyEntity } from "@/hooks/use-hierarchy-config";
import UpdateProgressTracker from "@/components/shared/update-progress";
import { SettingsSkeleton, PageLoader } from "@/components/shared/skeletons";
import BrandMark from "@/components/shared/brand-mark";
import { apiBaseUrl } from "@/lib/api/client";
import { cn } from "@/lib/utils/format";
import type { LucideIcon } from "lucide-react";

const profileSchema = z.object({
  full_name: z.string().min(1, "Le nom est obligatoire"),
  email: z.string().email("Saisissez un e-mail valide"),
});

// 8, matching the setup wizard and the server-side ChangePasswordDto. This
// asked for 6, so a 6- or 7-character password passed here and was then
// rejected by the API — back when the API checked at all.
const passwordSchema = z.object({
  current_password: z.string().min(1, "Le mot de passe actuel est obligatoire"),
  new_password: z.string().min(8, "Le mot de passe doit contenir au moins 8 caractères"),
  confirm_password: z.string().min(1, "Veuillez confirmer le mot de passe"),
}).refine((data) => data.new_password === data.confirm_password, {
  message: "Les mots de passe ne correspondent pas",
  path: ["confirm_password"],
});

type ProfileForm = z.infer<typeof profileSchema>;
type PasswordForm = z.infer<typeof passwordSchema>;

type SectionId = "profile" | "security" | "branding" | "theme" | "system" | "support" | "features" | "hierarchy" | "updates" | "backups";

const FEATURE_ICONS: Record<FeatureKey, LucideIcon> = {
  fields: BookOpen,
  levels: Layers,
  students: Users,
  professors: UserCheck,
  groups: Users,
  attendance: ClipboardCheck,
  "financial.dashboard": LayoutDashboard,
  "financial.studentPayments": Wallet,
  "financial.professorPayments": CircleDollarSign,
  "financial.analytics": TrendingUp,
  "financial.reports": FileText,
  "financial.transactions": Receipt,
  "financial.settings": SlidersHorizontal,
  import: Upload,
  audit: UserCog,
  backups: Database,
};

const ENTITY_ICONS: Record<HierarchyEntity, LucideIcon> = {
  level: Layers,
  field: BookOpen,
  professor: UserCheck,
  group: Users,
  student: Users,
};

/** Entity types hidden by each module toggle. */
const ENTITY_FEATURE: Partial<Record<HierarchyEntity, FeatureKey>> = {
  level: "levels",
  field: "fields",
  professor: "professors",
  group: "groups",
  student: "students",
};

/** Sidebar entries each feature toggle controls, shown as chips. */
const FEATURE_ITEMS: Record<FeatureKey, string[]> = {
  fields: ["nav.fields"],
  levels: ["nav.levels"],
  students: ["nav.students"],
  professors: ["nav.professors"],
  groups: ["nav.groups"],
  attendance: ["attendanceSheet.title"],
  "financial.dashboard": ["nav.financialDashboard"],
  "financial.studentPayments": ["nav.studentPayments"],
  "financial.professorPayments": ["nav.professorPayments"],
  "financial.analytics": ["nav.revenueAnalytics"],
  "financial.reports": ["nav.financialReports"],
  "financial.transactions": ["nav.transactionsHistory"],
  "financial.settings": ["nav.financialSettings"],
  import: ["nav.import"],
  audit: ["nav.audit"],
  backups: ["settings.backupTitle"],
};

/** Toggle groups, mirroring the sidebar's sections. */
const FEATURE_GROUPS: Array<{ labelKey: string; keys: FeatureKey[] }> = [
  {
    labelKey: "settings.features.groupAcademics",
    keys: ["fields", "levels", "students", "professors", "groups", "attendance"],
  },
  {
    labelKey: "settings.features.groupFinancial",
    keys: [
      "financial.dashboard",
      "financial.studentPayments",
      "financial.professorPayments",
      "financial.analytics",
      "financial.reports",
      "financial.transactions",
      "financial.settings",
    ],
  },
  {
    labelKey: "settings.features.groupAdministration",
    keys: ["import", "audit", "backups"],
  },
];

/** Financial screens shown in the sidebar preview, one per feature toggle. */
const PREVIEW_FINANCIAL: Array<{ feature: FeatureKey; labelKey: string; icon: LucideIcon }> = [
  { feature: "financial.dashboard", labelKey: "nav.financialDashboard", icon: LayoutDashboard },
  { feature: "financial.studentPayments", labelKey: "nav.studentPayments", icon: Wallet },
  { feature: "financial.professorPayments", labelKey: "nav.professorPayments", icon: CircleDollarSign },
  { feature: "financial.analytics", labelKey: "nav.revenueAnalytics", icon: TrendingUp },
  { feature: "financial.reports", labelKey: "nav.financialReports", icon: FileText },
  { feature: "financial.transactions", labelKey: "nav.transactionsHistory", icon: Receipt },
  { feature: "financial.settings", labelKey: "nav.financialSettings", icon: SlidersHorizontal },
];

/** A feature is on unless the stored row explicitly says false. */
const normalized = (features: Record<string, boolean> | undefined): Record<string, boolean> =>
  Object.fromEntries(FEATURE_KEYS.map((key) => [key, isFeatureEnabled(features, key)]));

export default function SettingsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { user, setSession } = useAuthStore();
  const [active, setActive] = useState<SectionId>("profile");
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPasswords, setShowPasswords] = useState(false);
  const [backupVersion, setBackupVersion] = useState("");
  const [restoreConfirm, setRestoreConfirm] = useState("");
  const [selectedRestoreId, setSelectedRestoreId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const updateStatus = useUpdateStore((s) => s.status);
  const updateChecking = useUpdateStore((s) => s.checking);
  const updateApplying = useUpdateStore((s) => s.applying);
  const updateFailed = useUpdateStore((s) => s.failed);
  const updateProgress = useUpdateStore((s) => s.progress);

  const checkNow = async () => {
    const result = await useUpdateStore.getState().refresh(true);
    if (result?.available) useUpdateStore.getState().openDialog();
  };

  const applyUpdate = async () => {
    const store = useUpdateStore.getState();
    store.setApplying(true);
    store.setFailed(false);
    store.setProgress(null);
    try {
      const result = await updatesApi.apply();
      if (!result.ok || !result.started) {
        store.setApplying(false);
        store.setFailed(true);
      }
    } catch {
      store.setApplying(false);
      store.setFailed(true);
    }
  };

  const { data: profile } = useQuery({
    queryKey: ["users", "me"],
    queryFn: usersApi.me,
  });

  const { data: backups, isLoading: backupsLoading } = useBackups();
  const createBackupMutation = useCreateBackup();
  const restoreBackupMutation = useRestoreBackup();

  const { data: settings } = useFinancialSettings();
  const uploadLogo = useUploadLogo();
  const removeLogo = useRemoveLogo();

  const { data: system } = useSystemSettings();
  const updateSystem = useUpdateSystemSettings();
  const { entityOrder, getEntityLabel } = useHierarchyConfig();
  const { theme, setTheme, accent, setAccent } = useAppearance();

  const [systemName, setSystemName] = useState("");
  const [featuresDraft, setFeaturesDraft] = useState<Record<string, boolean>>({});
  const [supportDraft, setSupportDraft] = useState({ email: "", phone: "", whatsapp: "" });

  useEffect(() => {
    if (system) {
      setSystemName(system.system_name ?? "");
      setFeaturesDraft(normalized(system.features));
      setSupportDraft({
        email: system.support_email ?? "",
        phone: system.support_phone ?? "",
        whatsapp: system.support_whatsapp ?? "",
      });
    }
  }, [system]);

  const systemDirty = systemName.trim() !== (system?.system_name?.trim() ?? "");
  const featuresDirty = JSON.stringify(featuresDraft) !== JSON.stringify(normalized(system?.features));
  const supportDirty =
    supportDraft.email.trim() !== (system?.support_email ?? "") ||
    supportDraft.phone.trim() !== (system?.support_phone ?? "") ||
    supportDraft.whatsapp.trim() !== (system?.support_whatsapp ?? "");
  const enabledCount = FEATURE_KEYS.filter((key) => featuresDraft[key] !== false).length;
  const brandLogo = settings?.logo_path
    ? `${apiBaseUrl()}/financial/settings/logo?v=${new Date(settings.updated_at).getTime()}`
    : null;

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
      setSession(data);
      queryClient.invalidateQueries({ queryKey: ["users", "me"] });
      setSuccess(t("settings.profileUpdated"));
      setError(null);
      setTimeout(() => setSuccess(null), 3000);
    },
    onError: () => {
      setError("Échec de la mise à jour du profil");
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
      setError("Échec du changement de mot de passe");
      setSuccess(null);
    },
  });

  const onProfileSubmit = (data: ProfileForm) => {
    updateProfileMutation.mutate(data);
  };

  const onPasswordSubmit = (data: PasswordForm) => {
    changePasswordMutation.mutate(data);
  };

  const saveSystem = () => {
    setError(null);
    const patch: {
      system_name?: string;
      features?: Record<string, boolean>;
      support_email?: string;
      support_phone?: string;
      support_whatsapp?: string;
    } = {};
    if (systemDirty) patch.system_name = systemName.trim();
    if (featuresDirty) patch.features = featuresDraft;
    if (supportDirty) {
      patch.support_email = supportDraft.email.trim();
      patch.support_phone = supportDraft.phone.trim();
      patch.support_whatsapp = supportDraft.whatsapp.trim();
    }
    updateSystem.mutate(patch, {
      onSuccess: () => {
        setSuccess(t("settings.systemSaved"));
        setError(null);
        setTimeout(() => setSuccess(null), 3000);
      },
      onError: () => {
        setError(t("common.somethingWentWrong", "Something went wrong"));
        setSuccess(null);
      },
    });
  };

  const SECTIONS: Array<{ id: SectionId; icon: LucideIcon; label: string; description: string }> = [
    { id: "profile", icon: User, label: t("settings.profileTitle"), description: t("settings.profileDescription") },
    { id: "security", icon: Lock, label: t("settings.securityTitle"), description: t("settings.securityDescription") },
    { id: "branding", icon: Palette, label: t("settings.brandingTitle"), description: t("settings.brandingDescription") },
    { id: "theme", icon: SunMoon, label: t("settings.themeTitle"), description: t("settings.themeDescription") },
    { id: "system", icon: Globe, label: t("settings.systemTitle"), description: t("settings.systemDescription") },
    { id: "support", icon: Headset, label: t("settings.supportSectionTitle"), description: t("settings.supportSectionDescription") },
    { id: "features", icon: ToggleLeft, label: t("settings.featuresTitle"), description: t("settings.featuresDescription") },
    { id: "hierarchy", icon: Network, label: t("hierarchy.title", "Navigation Hierarchy"), description: t("hierarchy.subtitle", "Configure hierarchy navigation order") },
    { id: "updates", icon: Download, label: t("settings.updatesTitle", "System Updates"), description: t("settings.updatesDescription", "Check for and apply new versions of the system") },
    ...(isFeatureEnabled(system?.features, "backups")
      ? [{ id: "backups" as SectionId, icon: Database, label: t("settings.backupTitle", "Database Backup"), description: t("settings.backupDescription", "Create, list, and restore versioned database backups") }]
      : []),
  ];
  const goTo = (id: SectionId) => {
    setActive(id);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm text-text-secondary mb-1">
              <Link href="/dashboard" className="hover:text-primary">{t("nav.dashboard")}</Link>
              <ChevronRight size={14} />
              <span className="text-text-primary font-medium">{t("settings.title")}</span>
            </div>
            <h2 className="text-h3 font-bold text-text-primary">{t("settings.title")}</h2>
            <p className="text-xs text-text-secondary mt-0.5">{t("settings.subtitle")}</p>
          </div>
        </div>

        {!profile ? (
          <PageLoader text={t("common.loading", "Loading…")} />
        ) : (
        <div>

        {success && (
          <div className="bg-success-soft dark:bg-success-dark-soft border border-success/30 dark:border-success-dark/30 text-success-strong dark:text-success-dark-strong text-sm rounded-input px-4 py-3 flex items-center gap-2 shadow-sm">
            <span className="h-2 w-2 rounded-full bg-success dark:bg-success-dark shrink-0" />
            {success}
          </div>
        )}

        {error && (
          <div className="bg-danger-soft dark:bg-danger-dark-soft border border-danger/30 dark:border-danger-dark/30 text-danger-strong dark:text-danger-dark-strong text-sm rounded-input px-4 py-3 flex items-center gap-2 shadow-sm">
            <span className="h-2 w-2 rounded-full bg-danger dark:bg-danger-dark shrink-0" />
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-6 lg:gap-8 items-start">
          {/* Section navigator */}
          <aside className="lg:sticky lg:top-8">
            <nav
              className="card p-3 flex lg:flex-col gap-1.5 overflow-x-auto scrollbar-thin lg:overflow-visible"
              aria-label={t("settings.title")}
            >
              {SECTIONS.map((section) => {
                const Icon = section.icon;
                const isActive = active === section.id;
                return (
                  <button
                    key={section.id}
                    onClick={() => goTo(section.id)}
                    aria-current={isActive ? "true" : undefined}
                    className={cn(
                      "flex items-center gap-3 rounded-btn px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors duration-150 shrink-0 lg:shrink lg:w-full",
                      isActive
                        ? "bg-primary text-white shadow-sm"
                        : "text-text-secondary hover:bg-neutral-soft hover:text-text-primary",
                    )}
                  >
                    <Icon size={16} className="shrink-0" />
                    <span>{section.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>

          {/* Active section content */}
          <div className="space-y-6 min-w-0">
            {active === "profile" && (
              <div className="card max-w-xl">
                {/* Profile Section */}
                  <div className="flex items-center gap-3 mb-5">
                    <div className="h-10 w-10 rounded-card bg-primary-50 dark:bg-primary/15 flex items-center justify-center text-primary">
                      <User size={20} />
                    </div>
                    <div>
                      <h3 className="text-h4 font-bold text-text-primary">{t("settings.profileTitle")}</h3>
                      <p className="text-xs text-text-secondary">{t("settings.profileDescription")}</p>
                    </div>
                  </div>

                  <form onSubmit={profileForm.handleSubmit(onProfileSubmit)} className="space-y-4">
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

                    <div className="flex justify-end pt-1">
                      <FormButton type="submit" isLoading={updateProfileMutation.isPending} className="btn btn-primary text-xs">
                        <Save size={14} /> {t("settings.saveChanges")}
                      </FormButton>
                    </div>
                  </form>
              </div>
            )}

            {active === "security" && (
              <div className="card max-w-xl">
                <div className="flex items-center gap-3 mb-5">
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
                        aria-label={showPasswords ? "Masquer le mot de passe" : "Afficher le mot de passe"}
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
                        aria-label={showPasswords ? "Masquer le mot de passe" : "Afficher le mot de passe"}
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
                        aria-label={showPasswords ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                      >
                        {showPasswords ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    {passwordForm.formState.errors.confirm_password && (
                      <p className="text-xs text-danger dark:text-danger-dark mt-1">{passwordForm.formState.errors.confirm_password.message}</p>
                    )}
                  </div>

                  <div className="flex justify-end pt-1">
                    <FormButton type="submit" isLoading={changePasswordMutation.isPending} className="btn btn-primary text-xs">
                      <Save size={14} /> {t("settings.saveChanges")}
                    </FormButton>
                  </div>
                </form>
              </div>
            )}

            {active === "branding" && (
              <div className="card overflow-hidden">
                <div className="flex items-center gap-3 mb-5">
                  <div className="h-10 w-10 rounded-card bg-primary-50 dark:bg-primary/15 flex items-center justify-center text-primary">
                    <Palette size={20} />
                  </div>
                  <div>
                    <h3 className="text-h4 font-bold text-text-primary">{t("settings.brandingTitle", "Branding")}</h3>
                    <p className="text-xs text-text-secondary">{t("settings.brandingDescription", "Upload a logo used in printable documents, the sidebar, and as the browser favicon.")}</p>
                  </div>
                </div>

                <div
                  onDragEnter={(e) => {
                    e.preventDefault();
                    dragCounterRef.current += 1;
                    if (dragCounterRef.current === 1) {
                      setIsDragging(true);
                    }
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    dragCounterRef.current -= 1;
                    if (dragCounterRef.current === 0) {
                      setIsDragging(false);
                    }
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "copy";
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    dragCounterRef.current = 0;
                    setIsDragging(false);
                    const file = e.dataTransfer.files?.[0];
                    if (!file) return;
                    setError(null);
                    uploadLogo.mutate(file, {
                      onSuccess: () => {
                        setError(null);
                        setSuccess(t("settings.logoSaved"));
                        setTimeout(() => setSuccess(null), 4000);
                      },
                      onError: (err) => setError((err as Error)?.message || t("common.somethingWentWrong", "Something went wrong")),
                    });
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      fileInputRef.current?.click();
                    }
                  }}
                  className={cn(
                    "group relative flex cursor-pointer flex-col items-center justify-center gap-4 rounded-card border-2 border-dashed p-10 text-center transition-all duration-200 outline-none",
                    isDragging
                      ? "border-primary bg-primary-50 dark:bg-primary/10"
                      : "border-border bg-background hover:border-primary/60 hover:bg-primary-50/50 dark:hover:bg-primary/5",
                    uploadLogo.isPending && "pointer-events-none opacity-70",
                  )}
                >
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
                        onSuccess: () => {
                          setError(null);
                          setSuccess(t("settings.logoSaved"));
                          setTimeout(() => setSuccess(null), 4000);
                        },
                        onError: (err) => setError((err as Error)?.message || t("common.somethingWentWrong", "Something went wrong")),
                      });
                      e.target.value = "";
                    }}
                  />

                  {logoUrl ? (
                    <div className="flex flex-col items-center gap-4">
                      <div className="h-28 w-28 overflow-hidden rounded-card border border-border bg-background shadow-sm">
                        <img src={logoUrl} alt={settings?.academy_name ?? "Academy"} className="h-full w-full object-contain" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-text-primary">{t("settings.logoUploaded", "Logo uploaded")}</p>
                        <p className="text-xs text-text-secondary">{t("settings.logoReplaceHint", "Drag a new file here or click to replace")}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-4">
                      <div className={cn("flex h-14 w-14 items-center justify-center rounded-full transition-all duration-200", isDragging ? "bg-primary/15 text-primary scale-110" : "bg-neutral-soft text-text-secondary group-hover:text-primary group-hover:scale-105")}>
                        <ImagePlus size={28} aria-hidden="true" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-text-primary">{t("settings.logoDropTitle", "Drop your logo here")}</p>
                        <p className="text-xs text-text-secondary">{t("settings.logoDropSubtitle", "or click to browse")}</p>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium", isDragging ? "bg-primary text-white" : "bg-neutral-soft text-text-secondary")}>
                      <Upload size={10} aria-hidden="true" />
                      PNG / JPG / WebP
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-soft px-2.5 py-1 text-[11px] font-medium text-text-secondary">
                      Max 2 MB
                    </span>
                  </div>

                  {uploadLogo.isPending && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-card bg-background/80 backdrop-blur-sm">
                      <div className="flex items-center gap-2 text-sm text-text-primary">
                        <RefreshCw size={16} className="animate-spin" aria-hidden="true" />
                        {t("settings.uploading", "Uploading…")}
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <p className="text-[11px] text-text-secondary">
                    {t("settings.logoFormat", "PNG, JPG or WebP — up to 2 MB. The file is served from the backend; the old one is deleted on replace.")}
                  </p>
                  {logoUrl && (
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        removeLogo.mutate(undefined, {
                          onSuccess: () => {
                            setError(null);
                            setSuccess(t("settings.logoRemoved"));
                            setTimeout(() => setSuccess(null), 4000);
                          },
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
              </div>
            )}

            {active === "theme" && (
              <div className="card max-w-xl">
                <div className="flex items-center gap-3 mb-5">
                  <div className="h-10 w-10 rounded-card bg-primary-50 dark:bg-primary/15 flex items-center justify-center text-primary">
                    <SunMoon size={20} />
                  </div>
                  <div>
                    <h3 className="text-h4 font-bold text-text-primary">{t("settings.themeTitle", "Apparence")}</h3>
                    <p className="text-xs text-text-secondary">{t("settings.themeDescription", "Choisissez le mode d'affichage et la couleur d'accent.")}</p>
                  </div>
                </div>

                <div className="space-y-8">
                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-2">
                      {t("settings.themeModeLabel", "Mode d'affichage")}
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { id: "light" as const, label: t("settings.themeLight", "Clair"), swatch: "#F8FAFC" },
                        { id: "dark" as const, label: t("settings.themeDark", "Sombre"), swatch: "#1E293B" },
                      ].map((mode) => {
                        const activeMode = theme === mode.id;
                        return (
                          <button
                            key={mode.id}
                            type="button"
                            onClick={() => setTheme(mode.id)}
                            aria-pressed={activeMode}
                            className={cn(
                              "flex items-center gap-3 rounded-card border-2 p-4 text-left transition-all duration-150",
                              activeMode
                                ? "border-primary bg-primary-50/60 dark:bg-primary/15"
                                : "border-border bg-background hover:border-primary/40",
                            )}
                          >
                            <span
                              className="h-8 w-8 shrink-0 rounded-full border border-border shadow-sm"
                              style={{ backgroundColor: mode.swatch }}
                            />
                            <span className="text-sm font-semibold text-text-primary">{mode.label}</span>
                            {activeMode && (
                              <CheckCircle2 size={18} className="ml-auto shrink-0 text-primary" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-2">
                      {t("settings.themeAccentLabel", "Couleur d'accent")}
                    </label>
                    <div className="flex flex-wrap items-start gap-4">
                      {ACCENT_IDS.map((id) => {
                        const preset = ACCENT_PRESETS[id];
                        const activeAccent = accent === id;
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => setAccent(id)}
                            aria-pressed={activeAccent}
                            className="flex flex-col items-center gap-1.5 outline-none"
                          >
                            <span
                              className={cn(
                                "relative h-10 w-10 rounded-full transition-all duration-150",
                                activeAccent
                                  ? "ring-2 ring-primary ring-offset-2 ring-offset-surface scale-110"
                                  : "hover:scale-105",
                              )}
                              style={{ backgroundColor: preset.swatch }}
                            >
                              <span
                                className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-surface"
                                style={{ backgroundColor: `rgb(${preset.goldRamp[0]})` }}
                              />
                            </span>
                            <span className={cn("text-xs", activeAccent ? "font-semibold text-text-primary" : "text-text-secondary")}>
                              {t(`settings.themeAccents.${id}`, preset.id)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-xs text-text-secondary mt-3">
                      {t("settings.themeAccentHint", "La couleur d'accent s'applique aux boutons, liens et éléments de marque. Enregistrée sur cet appareil.")}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {active === "system" && (
              <div className="card">
                <div className="flex items-center gap-3 mb-5">
                  <div className="h-10 w-10 rounded-card bg-primary-50 dark:bg-primary/15 flex items-center justify-center text-primary">
                    <Globe size={20} />
                  </div>
                  <div>
                    <h3 className="text-h4 font-bold text-text-primary">{t("settings.systemTitle")}</h3>
                    <p className="text-xs text-text-secondary">{t("settings.systemDescription")}</p>
                  </div>
                </div>

                <div className="space-y-6">
                  <div>
                    <label htmlFor="system_name" className="block text-sm font-medium text-text-primary mb-1.5">
                      {t("settings.systemNameLabel")}
                    </label>
                    <input
                      id="system_name"
                      type="text"
                      value={systemName}
                      onChange={(e) => setSystemName(e.target.value)}
                      placeholder={t("settings.systemNamePlaceholder")}
                      maxLength={60}
                      className="input w-full max-w-md"
                    />
                    <p className="text-xs text-text-secondary mt-1">{t("settings.systemNameHint")}</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-2">{t("settings.language")}</label>
                    <div className="inline-flex items-center gap-2 rounded-btn border border-border bg-background px-3 py-2 text-xs font-medium text-text-primary">
                      Français (FR)
                    </div>
                    <p className="text-xs text-text-secondary mt-1.5">{t("settings.languageHint", "L'interface est disponible en français uniquement.")}</p>
                  </div>

                  <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
                    {systemDirty && (
                      <span className="flex items-center gap-1.5 text-xs text-text-secondary">
                        <span className="h-2 w-2 rounded-full bg-gold animate-pulse" />
                        {t("settings.unsaved")}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={saveSystem}
                      disabled={!systemDirty || updateSystem.isPending}
                      className="btn btn-primary text-xs min-h-[36px] disabled:opacity-50"
                    >
                      {updateSystem.isPending ? (
                        <RefreshCw size={14} className="animate-spin" />
                      ) : (
                        <Save size={14} />
                      )}
                      {t("settings.saveChanges")}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {active === "support" && (
              <div className="card">
                <div className="flex items-center gap-3 mb-5">
                  <div className="h-10 w-10 rounded-card bg-primary-50 dark:bg-primary/15 flex items-center justify-center text-primary">
                    <Headset size={20} />
                  </div>
                  <div>
                    <h3 className="text-h4 font-bold text-text-primary">{t("settings.supportSectionTitle")}</h3>
                    <p className="text-xs text-text-secondary">{t("settings.supportSectionDescription")}</p>
                  </div>
                </div>

                <div className="space-y-6">
                  <div>
                    <label htmlFor="support_email" className="block text-sm font-medium text-text-primary mb-1.5">
                      {t("settings.supportEmailLabel")}
                    </label>
                    <input
                      id="support_email"
                      type="email"
                      value={supportDraft.email}
                      onChange={(e) => setSupportDraft((d) => ({ ...d, email: e.target.value }))}
                      placeholder={t("settings.supportEmailPlaceholder")}
                      maxLength={120}
                      className="input w-full max-w-md"
                    />
                    <p className="text-xs text-text-secondary mt-1">{t("settings.supportEmailHint")}</p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg">
                    <div>
                      <label htmlFor="support_phone" className="block text-sm font-medium text-text-primary mb-1.5">
                        {t("settings.supportPhoneLabel")}
                      </label>
                      <input
                        id="support_phone"
                        type="tel"
                        value={supportDraft.phone}
                        onChange={(e) => setSupportDraft((d) => ({ ...d, phone: e.target.value }))}
                        placeholder={t("settings.supportPhonePlaceholder")}
                        maxLength={60}
                        className="input w-full"
                      />
                    </div>
                    <div>
                      <label htmlFor="support_whatsapp" className="block text-sm font-medium text-text-primary mb-1.5">
                        {t("settings.supportWhatsappLabel")}
                      </label>
                      <input
                        id="support_whatsapp"
                        type="tel"
                        value={supportDraft.whatsapp}
                        onChange={(e) => setSupportDraft((d) => ({ ...d, whatsapp: e.target.value }))}
                        placeholder={t("settings.supportWhatsappPlaceholder")}
                        maxLength={60}
                        className="input w-full"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-text-secondary">{t("settings.supportHint")}</p>

                  <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
                    {supportDirty && (
                      <span className="flex items-center gap-1.5 text-xs text-text-secondary">
                        <span className="h-2 w-2 rounded-full bg-gold animate-pulse" />
                        {t("settings.unsaved")}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={saveSystem}
                      disabled={!supportDirty || updateSystem.isPending}
                      className="btn btn-primary text-xs min-h-[36px] disabled:opacity-50"
                    >
                      {updateSystem.isPending ? (
                        <RefreshCw size={14} className="animate-spin" />
                      ) : (
                        <Save size={14} />
                      )}
                      {t("settings.saveChanges")}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {active === "features" && (
              <div className="grid grid-cols-1 xl:grid-cols-[1fr_280px] gap-6 items-start">
                <div className="space-y-6 min-w-0">
                  <div className="card">
                    <div className="flex items-center gap-3 mb-5">
                      <div className="h-10 w-10 rounded-card bg-primary-50 dark:bg-primary/15 flex items-center justify-center text-primary">
                        <ToggleLeft size={20} />
                      </div>
                      <div>
                        <h3 className="text-h4 font-bold text-text-primary">{t("settings.featuresTitle")}</h3>
                        <p className="text-xs text-text-secondary">{t("settings.featuresDescription")}</p>
                        <p className="text-[11px] text-text-secondary/80 mt-1">{t("settings.featuresHint")}</p>
                      </div>
                    </div>

                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-soft px-3 py-1 text-xs font-medium text-text-secondary">
                        <span className={cn("h-2 w-2 rounded-full", enabledCount === FEATURE_KEYS.length ? "bg-success" : "bg-gold")} />
                        {enabledCount} / {FEATURE_KEYS.length} {t("settings.modulesEnabled")}
                      </span>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setFeaturesDraft(Object.fromEntries(FEATURE_KEYS.map((key) => [key, true])))}
                          disabled={enabledCount === FEATURE_KEYS.length}
                          className="text-xs font-medium text-primary hover:underline disabled:opacity-40 disabled:hover:no-underline"
                        >
                          {t("settings.enableAll")}
                        </button>
                        <span className="text-text-secondary/50">·</span>
                        <button
                          type="button"
                          onClick={() => setFeaturesDraft(Object.fromEntries(FEATURE_KEYS.map((key) => [key, false])))}
                          disabled={enabledCount === 0}
                          className="text-xs font-medium text-text-secondary hover:text-danger hover:underline disabled:opacity-40 disabled:hover:no-underline"
                        >
                          {t("settings.disableAll")}
                        </button>
                      </div>
                    </div>

                    <div className="rounded-btn border border-border overflow-hidden divide-y divide-border">
                      {FEATURE_GROUPS.map((group) => (
                        <Fragment key={group.labelKey}>
                          <div className="px-4 py-2 bg-neutral-soft/50">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
                              {t(group.labelKey)}
                            </p>
                          </div>
                          {group.keys.map((key) => {
                            const Icon = FEATURE_ICONS[key];
                            const enabled = featuresDraft[key] !== false;
                            const items = FEATURE_ITEMS[key];
                            const toggle = () => setFeaturesDraft((prev) => ({ ...prev, [key]: !(prev[key] !== false) }));
                            return (
                              <div
                                key={key}
                                role="button"
                                tabIndex={0}
                                aria-pressed={enabled}
                                onClick={toggle}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    toggle();
                                  }
                                }}
                                className={cn(
                                  "flex items-center gap-4 px-4 py-3.5 transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset",
                                  enabled ? "hover:bg-neutral-soft/60" : "bg-neutral-soft/30 hover:bg-neutral-soft/50",
                                )}
                              >
                                <div
                                  className={cn(
                                    "h-9 w-9 shrink-0 rounded-btn flex items-center justify-center transition-colors",
                                    enabled
                                      ? "bg-primary-50 dark:bg-primary/15 text-primary"
                                      : "bg-background text-text-secondary",
                                  )}
                                >
                                  <Icon size={16} />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <p className={cn("text-sm font-semibold", enabled ? "text-text-primary" : "text-text-secondary")}>
                                      {t(`settings.features.${key}.title`)}
                                    </p>
                                    {enabled ? (
                                      <span className="inline-flex items-center gap-1 rounded-full bg-success-soft dark:bg-success-dark-soft px-2 py-0.5 text-[10px] font-medium text-success-strong dark:text-success-dark-strong">
                                        <span className="h-1.5 w-1.5 rounded-full bg-success dark:bg-success-dark" />
                                        {t("settings.featureVisible")}
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 rounded-full bg-background border border-border px-2 py-0.5 text-[10px] font-medium text-text-secondary">
                                        {t("settings.featuresHidden")}
                                      </span>
                                    )}
                                  </div>
                                  <p className={cn("text-xs mt-0.5", enabled ? "text-text-secondary" : "text-text-secondary/70")}>
                                    {t(`settings.features.${key}.desc`)}
                                  </p>
                                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                                    {items.slice(0, 3).map((labelKey) => (
                                      <span
                                        key={labelKey}
                                        className={cn(
                                          "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                                          enabled
                                            ? "border-primary/20 bg-primary-50/60 dark:bg-primary/10 text-primary"
                                            : "border-border bg-background text-text-secondary/70",
                                        )}
                                      >
                                        {t(labelKey)}
                                      </span>
                                    ))}
                                    {items.length > 3 && (
                                      <span
                                        className={cn(
                                          "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                                          enabled ? "border-border text-text-secondary" : "border-border text-text-secondary/70",
                                        )}
                                      >
                                        +{items.length - 3}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <span onClick={(e) => e.stopPropagation()}>
                                  <Switch
                                    checked={enabled}
                                    onChange={() => toggle()}
                                    ariaLabel={t(`settings.features.${key}.title`)}
                                  />
                                </span>
                              </div>
                            );
                          })}
                        </Fragment>
                      ))}
                    </div>

                    <div className="mt-4 flex items-center justify-end gap-3 border-t border-border pt-4">
                      {featuresDirty && (
                        <span className="flex items-center gap-1.5 text-xs text-text-secondary">
                          <span className="h-2 w-2 rounded-full bg-gold animate-pulse" />
                          {t("settings.unsaved")}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={saveSystem}
                        disabled={!featuresDirty || updateSystem.isPending}
                        className="btn btn-primary text-xs min-h-[36px] disabled:opacity-50"
                      >
                        {updateSystem.isPending ? (
                          <RefreshCw size={14} className="animate-spin" />
                        ) : (
                          <Save size={14} />
                        )}
                        {t("settings.saveChanges")}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Live sidebar preview */}
                <div className="xl:sticky xl:top-8 space-y-3">
                  <div>
                    <h4 className="text-sm font-semibold text-text-primary">{t("settings.previewTitle")}</h4>
                    <p className="text-xs text-text-secondary mt-0.5">{t("settings.previewHint")}</p>
                  </div>
                  <div className="rounded-card bg-primary dark:bg-primary-900 p-3 text-white shadow-md overflow-hidden">
                    <div className="flex items-center gap-2 px-2 py-1.5 mb-1">
                      {brandLogo ? (
                        <img src={brandLogo} alt="" className="h-6 w-6 rounded-btn object-contain" />
                      ) : (
                        <BrandMark name={systemName || t("app.name")} className="h-6 w-6 text-[9px]" />
                      )}
                      <span className="text-xs font-bold tracking-tight truncate">
                        {systemName || t("app.name")}
                      </span>
                    </div>

                    <PreviewItem label={t("nav.dashboard")} icon={LayoutDashboard} visible active />

                    <PreviewGroup
                      label={t("nav.financialManagement")}
                      icon={Wallet}
                      subItems={PREVIEW_FINANCIAL.map((item) => ({
                        label: t(item.labelKey),
                        icon: item.icon,
                        visible: isFeatureEnabled(featuresDraft, item.feature),
                      }))}
                      hiddenLabel={t("settings.featuresHidden")}
                    />

                    <PreviewGroup
                      label={t("nav.fields")}
                      icon={Network}
                      subItems={entityOrder.map((entity) => ({
                        label: getEntityLabel(entity),
                        icon: ENTITY_ICONS[entity],
                        visible: ENTITY_FEATURE[entity]
                          ? isFeatureEnabled(featuresDraft, ENTITY_FEATURE[entity] as FeatureKey)
                          : true,
                      }))}
                      hiddenLabel={t("settings.featuresHidden")}
                    />

                    <div className="!my-2 border-t border-white/10" />

                    <PreviewItem label={t("nav.import")} icon={Upload} visible={isFeatureEnabled(featuresDraft, "import")} hiddenLabel={t("settings.featuresHidden")} />
                    <PreviewItem label={t("nav.audit")} icon={UserCog} visible={isFeatureEnabled(featuresDraft, "audit")} hiddenLabel={t("settings.featuresHidden")} />
                    <PreviewItem label={t("nav.settings")} icon={Settings} visible />
                  </div>
                </div>
              </div>
            )}

            {active === "hierarchy" && (
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
                  className="btn btn-primary w-full text-xs min-h-[44px]"
                >
                  <Network size={14} /> {t("hierarchy.builder", "Hierarchy Builder")}
                </Link>
              </div>
            )}

            {active === "backups" && (
              <div className="card">
                <div className="flex items-center gap-3 mb-5">
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
                      className="input w-full max-w-md"
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
                    className="btn btn-primary w-full text-xs min-h-[44px] max-w-md"
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
                          <div key={b.id} className="rounded-btn border border-border bg-background p-3">
                            <div className="flex items-center justify-between gap-3">
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
                                className="btn btn-danger text-xs h-8 shrink-0"
                              >
                                <RefreshCw size={12} />
                                {t("settings.restore", "Restore")}
                              </button>
                            </div>
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
            )}

            {active === "updates" && (
              <div className="card max-w-xl">
                <div className="flex items-center gap-3 mb-5">
                  <div className="h-10 w-10 rounded-card bg-primary-50 dark:bg-primary/15 flex items-center justify-center text-primary">
                    <Download size={20} />
                  </div>
                  <div>
                    <h3 className="text-h4 font-bold text-text-primary">{t("settings.updatesTitle", "System Updates")}</h3>
                    <p className="text-xs text-text-secondary">{t("settings.updatesDescription", "Keep the system up to date")}</p>
                  </div>
                </div>

                <div className="rounded-btn border border-border bg-background p-4">
                  <div className="flex items-center gap-2">
                    {updateStatus?.available ? (
                      <>
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-50 dark:bg-primary/15 px-3 py-1 text-xs font-medium text-primary">
                          <span className="h-2 w-2 rounded-full bg-gold animate-pulse" />
                          {t("updates.availableBadge")}
                        </span>
                        <p className="text-sm text-text-secondary">{t("updates.availableText")}</p>
                      </>
                    ) : updateStatus?.checkedAt ? (
                      <>
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft dark:bg-success-dark-soft px-3 py-1 text-xs font-medium text-success-strong dark:text-success-dark-strong">
                          <span className="h-2 w-2 rounded-full bg-success dark:bg-success-dark" />
                          {t("updates.upToDate")}
                        </span>
                        <p className="text-sm text-text-secondary">{t("updates.upToDateText")}</p>
                      </>
                    ) : (
                      <>
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-soft px-3 py-1 text-xs font-medium text-text-secondary">
                          <RefreshCw size={11} className={cn(updateChecking && "animate-spin")} />
                          {updateChecking ? t("updates.checking") : t("updates.checkPending")}
                        </span>
                        <p className="text-sm text-text-secondary">{t("updates.checkPendingText")}</p>
                      </>
                    )}
                  </div>

                  {updateStatus?.reason === "disabled" && (
                    <p className="mt-3 text-xs text-text-secondary/80">{t("updates.disabledHint")}</p>
                  )}
                  {updateStatus && updateStatus.reason && updateStatus.reason !== "disabled" && (
                    <p className="mt-3 text-xs text-text-secondary/80">{t("updates.unreachableHint")}</p>
                  )}

                  {updateFailed && (
                    <p role="alert" className="mt-3 text-xs text-danger">{t("updates.failed")}</p>
                  )}
                  {updateApplying && !updateProgress && (
                    <p className="mt-3 text-xs text-text-secondary">{t("updates.applying")}</p>
                  )}
                  {updateProgress && updateProgress.state !== "idle" && (
                    <div className="mt-3">
                      <UpdateProgressTracker />
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border pt-4">
                  <button
                    type="button"
                    onClick={checkNow}
                    disabled={updateChecking || updateApplying}
                    className="btn btn-secondary text-xs min-h-[36px] disabled:opacity-50"
                  >
                    {updateChecking ? (
                      <RefreshCw size={14} className="animate-spin" />
                    ) : (
                      <RefreshCw size={14} />
                    )}
                    {t("updates.checkNow")}
                  </button>
                  {updateStatus?.available && (
                    <button
                      type="button"
                      onClick={applyUpdate}
                      disabled={updateChecking || updateApplying}
                      className="btn btn-primary text-xs min-h-[36px] disabled:opacity-50"
                    >
                      {updateApplying ? (
                        <RefreshCw size={14} className="animate-spin" />
                      ) : (
                        <Download size={14} />
                      )}
                      {updateApplying ? t("updates.starting") : t("updates.now")}
                    </button>
                  )}
                </div>
              </div>
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
        )}
      </div>
    </div>
  );
}

function PreviewItem({
  label,
  icon: Icon,
  visible,
  active = false,
  hiddenLabel,
}: {
  label: string;
  icon: LucideIcon;
  visible: boolean;
  active?: boolean;
  hiddenLabel?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-btn px-2.5 py-2 text-xs font-medium transition-opacity",
        active ? "bg-gold text-primary shadow-sm" : "text-white/80",
        !visible && "opacity-40",
      )}
    >
      <Icon size={14} className="shrink-0" />
      <span className="flex-1 truncate">{label}</span>
      {!visible && hiddenLabel && (
        <span className="text-[9px] uppercase tracking-wide">{hiddenLabel}</span>
      )}
    </div>
  );
}

function PreviewGroup({
  label,
  icon: Icon,
  subItems,
  hiddenLabel,
}: {
  label: string;
  icon: LucideIcon;
  subItems: Array<{ label: string; icon: LucideIcon; visible: boolean }>;
  hiddenLabel?: string;
}) {
  const anyVisible = subItems.some((item) => item.visible);
  return (
    <div className={cn("mt-1", !anyVisible && "opacity-40")}>
      <div className="flex items-center gap-2.5 rounded-btn px-2.5 py-2 text-xs font-medium text-white/70">
        <Icon size={14} className="shrink-0" />
        <span className="flex-1 truncate">{label}</span>
        <ChevronDown size={12} className="shrink-0 text-white/50" />
        {!anyVisible && hiddenLabel && (
          <span className="text-[9px] uppercase tracking-wide text-white/60">{hiddenLabel}</span>
        )}
      </div>
      <div className="ml-3 mt-0.5 space-y-0.5 border-l-2 border-white/10 pl-2">
        {subItems.map((item) => {
          const SubIcon = item.icon;
          return (
            <div
              key={item.label}
              className={cn(
                "flex items-center gap-2 rounded-btn px-2 py-1.5 text-[11px]",
                item.visible ? "text-white/70" : "text-white/40",
              )}
            >
              <SubIcon size={12} className="shrink-0" />
              <span className="truncate">{item.label}</span>
              {!item.visible && hiddenLabel && (
                <span className="ml-auto text-[9px] uppercase tracking-wide text-white/40">{hiddenLabel}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Switch({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        checked ? "bg-primary" : "bg-neutral-soft border border-border",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200",
          checked && "translate-x-5",
        )}
      />
    </button>
  );
}

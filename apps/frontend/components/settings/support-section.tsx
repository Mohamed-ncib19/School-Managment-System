"use client";

import { Headset, Mail, MessageCircle, Phone, RefreshCw, Save } from "lucide-react";
import { useTranslation } from "@/lib/i18n/context";
import { FALLBACK_EMAIL, FALLBACK_PHONE_DISPLAY, FALLBACK_PHONE_LINK, digitsOnly } from "@/components/shared/contact-support";
import { cn } from "@/lib/utils/format";

export interface SupportDraft {
  email: string;
  phone: string;
  whatsapp: string;
}

interface SupportSectionProps {
  supportDraft: SupportDraft;
  setSupportDraft: (updater: (prev: SupportDraft) => SupportDraft) => void;
  supportDirty: boolean;
  saveSystem: () => void;
  updatePending: boolean;
}

/**
 * School-specific overrides for the developer contact behind the sidebar's
 * "Signaler un problème" modal. An empty field keeps the developer default —
 * the destination preview below always shows where reports actually go, using
 * the same fallback rule as the modal itself.
 */
export default function SupportSection({
  supportDraft,
  setSupportDraft,
  supportDirty,
  saveSystem,
  updatePending,
}: SupportSectionProps) {
  const { t } = useTranslation();

  const emailDest = supportDraft.email.trim() || FALLBACK_EMAIL;
  const emailCustom = supportDraft.email.trim() !== "";
  const phoneDisplay = supportDraft.phone.trim() || FALLBACK_PHONE_DISPLAY;
  const phoneCustom = supportDraft.phone.trim() !== "";
  const waNumber = digitsOnly(supportDraft.whatsapp) || digitsOnly(supportDraft.phone) || FALLBACK_PHONE_LINK;
  const waCustom = digitsOnly(supportDraft.whatsapp) !== "" || digitsOnly(supportDraft.phone) !== "";

  const destinations = [
    { icon: Mail, label: "E-mail", value: emailDest, custom: emailCustom },
    { icon: MessageCircle, label: "WhatsApp", value: `wa.me/${waNumber}`, custom: waCustom },
    { icon: Phone, label: t("settings.supportPhoneLabel"), value: phoneDisplay, custom: phoneCustom },
  ];

  return (
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

      <div className="rounded-btn border border-gold/40 bg-gold-50 dark:bg-gold/10 px-4 py-3 text-sm mb-6">
        {t("settings.supportBanner", "Les rapports envoyés depuis le bouton « Signaler un problème » de la barre latérale arrivent à ces coordonnées. Un champ vide garde le contact du développeur.")}
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

        <div className="rounded-btn border border-border bg-background p-4">
          <p className="text-xs font-semibold text-text-primary mb-3">
            {t("settings.supportDestinationTitle", "Destination actuelle des rapports")}
          </p>
          <div className="space-y-2">
            {destinations.map((dest) => {
              const Icon = dest.icon;
              return (
                <div key={dest.label} className="flex items-center gap-2.5 text-xs">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-btn bg-neutral-soft text-text-secondary">
                    <Icon size={13} />
                  </span>
                  <span className="font-medium text-text-secondary w-20 shrink-0">{dest.label}</span>
                  <span className="min-w-0 flex-1 truncate font-medium text-text-primary">{dest.value}</span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                      dest.custom
                        ? "bg-success-soft dark:bg-success-dark-soft text-success-strong dark:text-success-dark-strong"
                        : "bg-neutral-soft text-text-secondary",
                    )}
                  >
                    {dest.custom
                      ? t("settings.supportCustomBadge", "École")
                      : t("settings.supportDefaultBadge", "Développeur")}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

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
            disabled={!supportDirty || updatePending}
            className="btn btn-primary text-xs min-h-[36px] disabled:opacity-50"
          >
            {updatePending ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : (
              <Save size={14} />
            )}
            {t("settings.saveChanges")}
          </button>
        </div>
      </div>
    </div>
  );
}

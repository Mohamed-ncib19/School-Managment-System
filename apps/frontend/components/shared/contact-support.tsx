"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Headset, HelpCircle, Mail, MessageCircle, Phone, X, AlertTriangle } from "lucide-react";
import { useTranslation } from "@/lib/i18n/context";
import { useSystemSettings } from "@/hooks/use-system-settings";
import { cn } from "@/lib/utils/format";

/** Fallback contacts used when a school did not configure their own. */
const FALLBACK_EMAIL = "mohamedncib900@gmail.com";
const FALLBACK_PHONE_DISPLAY = "+216 55 518 492";
const FALLBACK_PHONE_LINK = "21655518492";

type ReportType = "technique" | "payment" | "attendance" | "other";

const REPORT_TYPES: ReportType[] = ["technique", "payment", "attendance", "other"];

/** Digits only, for wa.me / tel: links. */
function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

function nowLabel(): string {
  return new Date().toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * "Signal un problème" button in the sidebar footer, just above the signed-in
 * admins account card.
 *
 * A structured technical report: pick the type of issue, describe it, then
 * send by e-mail or WhatsApp in one click. The school name, the date and the
 * issue type are joined to the report automatically. Targets (email / WhatsApp /
 * phone) come from Settings > Contact support per school and fall back to the
 * product defaults when empty.
 */
export default function ContactSupport({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation();
  const { data: settings } = useSystemSettings();
  const schoolName = settings?.system_name ?? "Système de gestion scolaire";
  const [show, setShow] = useState(false);
  const [type, setType] = useState<ReportType>("technique");
  const [description, setDescription] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const email = settings?.support_email?.trim() || FALLBACK_EMAIL;
  const phoneDisplay = settings?.support_phone?.trim() || FALLBACK_PHONE_DISPLAY;
  const phoneLink = digitsOnly(phoneDisplay) || FALLBACK_PHONE_LINK;
  const whatsappNumber = digitsOnly(settings?.support_whatsapp ?? "") || phoneLink;

  useEffect(() => {
    if (!show || !textareaRef.current) return;
    textareaRef.current.focus();
  }, [show]);

  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShow(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show]);

  const typeLabel = t(`support.type.${type}`);
  const subject = `[Rapport technique] ${typeLabel} — ${schoolName}`;
  const reportBody = [
    `École : ${schoolName}`,
    `Date : ${nowLabel()}`,
    `Type de problème : ${typeLabel}`,
    "",
    description.trim(),
  ]
    .filter((line, i) => line !== "" || i === 4)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");

  const composeEmail = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(reportBody)}`;
  const composeWhatsApp = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(`${subject}\n${reportBody}`)}`;

  return (
    <>
      <button
        onClick={() => setShow(true)}
        className={`flex items-center gap-3 rounded-btn px-3 py-2.5 text-sm font-medium transition-colors duration-150 w-full ${
          collapsed
            ? "justify-center px-0 text-text-secondary hover:bg-black/[0.04] dark:hover:bg-white/[0.05] hover:text-text-primary"
            : "border border-border bg-surface text-text-primary hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
        }`}
        aria-label={t("support.contactAria")}
        title={t("support.contact")}
      >
        <Headset size={16} className="shrink-0" />
        {!collapsed && <span>{t("support.contact")}</span>}
      </button>

      {show && typeof window !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="support-title"
            onClick={() => setShow(false)}
          >
            <div
              className="mx-4 w-full max-w-md rounded-modal bg-surface p-6 shadow-modal"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <h3 id="support-title" className="flex items-center gap-2 text-h4 font-bold text-text-primary">
                  <AlertTriangle size={20} className="text-gold" />
                  {t("support.title")}
                </h3>
                <button
                  onClick={() => setShow(false)}
                  className="h-8 w-8 shrink-0 rounded-btn text-text-secondary hover:bg-neutral-soft dark:hover:bg-white/10 transition-colors flex items-center justify-center"
                  aria-label={t("support.close")}
                >
                  <X size={16} />
                </button>
              </div>
              <p className="mb-5 mt-1 text-sm text-text-secondary">
                {t("support.subtitle")}
              </p>

              <p className="mb-2 text-xs font-semibold text-text-primary">{t("support.typeLabel")}</p>
              <div className="grid grid-cols-2 gap-2" role="group" aria-label={t("support.typeLabel")}>
                {REPORT_TYPES.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setType(key)}
                    className={cn(
                      "rounded-btn border px-3 py-2 text-xs font-medium transition-colors text-left",
                      type === key
                        ? "border-gold bg-gold/15 text-gold"
                        : "border-border bg-background text-text-secondary hover:border-gold/40 hover:text-text-primary",
                    )}
                  >
                    {t(`support.type.${key}`)}
                  </button>
                ))}
              </div>

              <label htmlFor="support-description" className="mt-4 mb-1.5 block text-sm font-medium text-text-primary">
                {t("support.descriptionLabel")}
              </label>
              <textarea
                id="support-description"
                ref={textareaRef}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                maxLength={1000}
                placeholder={t("support.descriptionPlaceholder")}
                className="input w-full resize-none text-sm"
              />
              <p className="mt-1 text-[11px] text-text-secondary">{t("support.contextHint")}</p>

              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <a
                  href={composeEmail}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 rounded-btn border border-sky-500/50 bg-sky-50/60 dark:bg-sky-500/10 px-3 py-3 text-sm font-semibold text-text-primary transition-colors hover:bg-sky-100 dark:hover:bg-sky-500/20"
                >
                  <Mail size={16} className="text-sky-500" />
                  {t("support.sendEmail")}
                </a>
                <a
                  href={composeWhatsApp}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 rounded-btn border border-green-500/50 bg-green-50/60 dark:bg-green-500/10 px-3 py-3 text-sm font-semibold text-text-primary transition-colors hover:bg-green-100 dark:hover:bg-green-500/20"
                >
                  <MessageCircle size={16} className="text-green-500" />
                  {t("support.sendWhatsApp")}
                </a>
              </div>

              <a
                href={`tel:${phoneLink}`}
                className="mt-3 flex items-center justify-center gap-1.5 text-xs font-medium text-text-secondary hover:text-gold transition-colors"
              >
                <Phone size={13} className="text-gold" />
                {t("support.call")} {phoneDisplay}
              </a>

              <div className="mt-4 flex justify-center">
                <button className="btn btn-secondary text-sm" onClick={() => setShow(false)}>
                  {t("support.close")}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
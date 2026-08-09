"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Headset, HelpCircle, Mail, MessageCircle, Phone, X } from "lucide-react";
import { useTranslation } from "@/lib/i18n/context";
import { useSystemSettings } from "@/hooks/use-system-settings";

/** Fallback contacts used when a school did not configure their own. */
const FALLBACK_EMAIL = "mohamedncib900@gmail.com";
const FALLBACK_PHONE_DISPLAY = "+216 55 518 492";
const FALLBACK_PHONE_LINK = "21655518492";

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
 * "Contact support" button in the sidebar footer, just above the signed-in
 * admins account card.
 *
 * One text box, then pick a channel — every school runs its own installation,
 * so the targets (email / WhatsApp / phone) come from Settings > Contact
 * support for that school and fall back to the product defaults when empty.
 * The school name and the date are joined to the message automatically, so
 * nothing else has to be typed.
 */
export default function ContactSupport({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation();
  const { data: settings } = useSystemSettings();
  const schoolName = settings?.system_name ?? "Système de gestion scolaire";
  const [show, setShow] = useState(false);
  const [message, setMessage] = useState("");
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

  const subject = `Support — ${schoolName}`;
  const messageBody = [
    schoolName,
    nowLabel(),
    message.trim(),
  ]
    .filter(Boolean)
    .join("\n");

  const composeWhatsApp = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(messageBody)}`;
  const composeEmail = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(messageBody)}`;

  return (
    <>
      <button
        onClick={() => setShow(true)}
        className={`flex items-center gap-3 rounded-btn px-3 py-2.5 text-sm font-medium transition-all duration-150 w-full ${
          collapsed
            ? "justify-center px-0 text-gold hover:bg-gold/15"
            : "border border-gold/50 bg-gold/15 text-gold hover:bg-gold hover:text-primary hover:shadow-sm"
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
            aria-describedby="support-body"
            onClick={() => setShow(false)}
          >
            <div
              className="mx-4 w-full max-w-md rounded-modal bg-surface p-6 shadow-modal"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <h3 id="support-title" className="flex items-center gap-2 text-h4 font-bold text-text-primary">
                  <HelpCircle size={20} className="text-gold" />
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
              <p id="support-body" className="mb-5 mt-1 text-sm text-text-secondary">
                {t("support.subtitle")}
              </p>

              <label htmlFor="support-message" className="mb-1.5 block text-sm font-medium text-text-primary">
                {t("support.messageLabel")}
              </label>
              <textarea
                id="support-message"
                ref={textareaRef}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                maxLength={1000}
                placeholder={t("support.messagePlaceholder")}
                className="input w-full resize-none text-sm"
              />
              <p className="mt-1 text-[11px] text-text-secondary">{t("support.contextHint")}</p>

              <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <a
                  href={composeWhatsApp}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-col items-center gap-1.5 rounded-btn border border-border bg-background px-3 py-3.5 text-sm font-semibold text-text-primary transition-colors hover:border-green-500/60 hover:bg-green-50 dark:hover:bg-green-500/10"
                >
                  <MessageCircle size={20} className="text-green-500" />
                  {t("support.whatsapp")}
                </a>
                <a
                  href={composeEmail}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-col items-center gap-1.5 rounded-btn border border-border bg-background px-3 py-3.5 text-sm font-semibold text-text-primary transition-colors hover:border-sky-500/60 hover:bg-sky-500/10 dark:hover:bg-sky-500/10"
                >
                  <Mail size={20} className="text-sky-500" />
                  {t("support.email")}
                </a>
                <a
                  href={`tel:${phoneLink}`}
                  className="flex flex-col items-center gap-1.5 rounded-btn border border-border bg-background px-3 py-3.5 text-sm font-semibold text-text-primary transition-colors hover:border-gold/60 hover:bg-gold/10"
                >
                  <Phone size={20} className="text-gold" />
                  {t("support.phone")}
                </a>
              </div>

              <p className="mt-3 text-center text-xs text-text-secondary">
                {t("support.recipientHint")} {email}
              </p>

              <div className="mt-4 flex justify-end">
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
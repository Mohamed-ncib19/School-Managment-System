"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Headset, HelpCircle, Mail, MessageCircle, Phone } from "lucide-react";
import { useTranslation } from "@/lib/i18n/context";
import { useSystemSettings } from "@/hooks/use-system-settings";

const SUPPORT_EMAIL = "mohamedncib900@gmail.com";
const SUPPORT_PHONE_DISPLAY = "+216 55 518 492";
const SUPPORT_PHONE_LINK = "+21655518492";

interface ContactOption {
  channel: "email" | "whatsapp" | "phone";
  Icon: typeof Mail;
  href: string;
}

function emailHref(schoolName: string): string {
  const subject = `Urgence technique — Système de gestion scolaire de ${schoolName}`;
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${SUPPORT_EMAIL}&su=${encodeURIComponent(subject)}`;
}

/**
 * "Contact support" button in the sidebar footer, just above the signed-in
 * admins account card. Opens a modal with the three emergency contact
 * channels: email (Gmail compose), WhatsApp, and a direct phone call.
 */
export default function ContactSupport({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation();
  const { data: settings } = useSystemSettings();
  const schoolName = settings?.system_name ?? "Système de gestion scolaire";
  const [show, setShow] = useState(false);

  const contactOptions = [
    { channel: "email" as const, Icon: Mail, href: emailHref(schoolName) },
    { channel: "whatsapp" as const, Icon: MessageCircle, href: "https://wa.me/21655518492" },
    { channel: "phone" as const, Icon: Phone, href: `tel:${SUPPORT_PHONE_LINK}` },
  ];

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
            className="mx-4 w-full max-w-sm rounded-modal bg-surface p-6 shadow-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="support-title" className="flex items-center gap-2 text-h4 font-bold text-text-primary">
              <HelpCircle size={20} className="text-gold" />
              {t("support.title")}
            </h3>
            <p id="support-body" className="mb-5 mt-1 text-sm text-text-secondary">
              {t("support.subtitle")}
            </p>

            <div className="space-y-3">
              {contactOptions.map(({ channel, Icon, href }) => (
                <a
                  key={channel}
                  href={href}
                  target={channel === "email" || channel === "whatsapp" ? "_blank" : undefined}
                  rel={channel === "email" || channel === "whatsapp" ? "noopener noreferrer" : undefined}
                  className="flex items-center gap-3 rounded-btn border border-border bg-background px-4 py-3 transition-colors hover:border-gold/50 hover:bg-gold/5"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold/10 text-gold">
                    <Icon size={16} />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-text-primary">
                      {t(`support.${channel}`)}
                    </span>
                    <span className="block text-xs text-text-secondary">
                      {channel === "email" ? SUPPORT_EMAIL : SUPPORT_PHONE_DISPLAY}
                    </span>
                  </span>
                </a>
              ))}
            </div>

            <div className="mt-5 flex justify-end">
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
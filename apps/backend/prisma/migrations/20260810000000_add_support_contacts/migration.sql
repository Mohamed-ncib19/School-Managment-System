-- Per-school support contacts: which email, phone and WhatsApp number the
-- "Contact support" modal offers for this installation.
--
-- Each deployment hosts one school, so the contacts live on the singleton
-- settings row and are edited from Settings > Support. A NULL value makes the
-- channel fall back to the product defaults.

ALTER TABLE "system_settings"
    ADD COLUMN "support_email"    TEXT,
    ADD COLUMN "support_phone"    TEXT,
    ADD COLUMN "support_whatsapp" TEXT;
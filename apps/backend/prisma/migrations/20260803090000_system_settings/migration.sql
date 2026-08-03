-- School-wide system configuration: the display name of the system and the
-- per-module feature toggles that let each school hide what it does not use.
--
-- Mirrors the `financial_settings` singleton pattern: the CHECK constraint
-- makes a second row impossible, and the seed row is inserted here so the row
-- exists even on a fresh database (the service upserts anyway, belt and
-- braces).

CREATE TABLE "system_settings" (
    "singleton"   TEXT NOT NULL DEFAULT 'global',
    "system_name" TEXT NOT NULL DEFAULT 'IQ Academy',
    "features"    JSONB NOT NULL DEFAULT '{}',
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("singleton"),
    CONSTRAINT "system_settings_singleton_check" CHECK ("singleton" = 'global')
);

INSERT INTO "system_settings" ("singleton", "system_name", "features", "updated_at")
VALUES ('global', 'IQ Academy', '{}', CURRENT_TIMESTAMP);

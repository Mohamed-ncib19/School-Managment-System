-- Soft-delete support for fields: archiving a field must never break the
-- professors/groups that reference it, so it gets the same is_active flag the
-- other hierarchy sections already carry.

ALTER TABLE "fields" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "fields_is_active_idx" ON "fields" ("is_active");

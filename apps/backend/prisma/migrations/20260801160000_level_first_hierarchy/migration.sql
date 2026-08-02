-- Re-roots the academic hierarchy as level > field > professor > group > student.
--
-- Previously the chain was field > professor > level > group > student, so a
-- "level" was a private child of one professor and the same "Beginner" existed
-- once per teacher. A level is now school-wide and sits at the top.
--
-- Nothing is thrown away. Every group keeps the professor, level and field it
-- had, and no student or payment row is touched. The re-shaping is:
--
--   * levels sharing a name collapse into one root level (the active, oldest
--     row wins and keeps its id);
--   * a field is copied once per level it is taught at, because a field now
--     hangs off a level;
--   * a professor is copied once per level they teach, because a professor row
--     is now an assignment within one level's field. Both copies carry the same
--     name, phone, email and linked staff account.
--
-- Row ids are preserved wherever a row has exactly one home in the new shape,
-- so existing audit-log references keep resolving.

ALTER TABLE "fields" ADD COLUMN "level_id" UUID;
ALTER TABLE "groups" ADD COLUMN "prof_id" UUID;

-- One root level per distinct name. An active row is preferred over an archived
-- one so merging never silently archives a level that is still in use.
CREATE TEMPORARY TABLE tmp_level_root AS
SELECT DISTINCT ON (lower(btrim(l."name")))
       lower(btrim(l."name")) AS name_key,
       l."id"                 AS root_id,
       l."created_at"         AS root_created_at
FROM "levels" l
ORDER BY lower(btrim(l."name")), l."is_active" DESC, l."created_at", l."id";

-- Every old level row -> the root level it merges into, plus its professor.
CREATE TEMPORARY TABLE tmp_level_map AS
SELECT l."id"      AS old_level_id,
       l."prof_id" AS old_prof_id,
       r.root_id   AS root_id
FROM "levels" l
JOIN tmp_level_root r ON lower(btrim(l."name")) = r.name_key;

-- (level, field) pairs that actually exist, reached through the levels' professors.
CREATE TEMPORARY TABLE tmp_field_map AS
SELECT root_id,
       old_field_id,
       rn,
       CASE WHEN rn = 1 THEN old_field_id ELSE gen_random_uuid() END AS new_field_id
FROM (
  SELECT pair.root_id,
         pair.old_field_id,
         ROW_NUMBER() OVER (
           PARTITION BY pair.old_field_id
           ORDER BY lr.root_created_at, pair.root_id
         ) AS rn
  FROM (
    SELECT DISTINCT m.root_id, p."field_id" AS old_field_id
    FROM tmp_level_map m
    JOIN "professors" p ON p."id" = m.old_prof_id
  ) pair
  JOIN tmp_level_root lr ON lr.root_id = pair.root_id
) ranked;

-- The field keeps its own row under the first level it appears at; the rest are copies.
INSERT INTO "fields" ("id", "name", "description", "created_by", "created_at", "level_id")
SELECT fm.new_field_id, f."name", f."description", f."created_by", f."created_at", fm.root_id
FROM tmp_field_map fm
JOIN "fields" f ON f."id" = fm.old_field_id
WHERE fm.rn > 1;

UPDATE "fields" f
SET "level_id" = fm.root_id
FROM tmp_field_map fm
WHERE fm.rn = 1
  AND f."id" = fm.old_field_id;

-- (professor, level) pairs, one professor row each.
CREATE TEMPORARY TABLE tmp_prof_map AS
SELECT old_prof_id,
       root_id,
       rn,
       CASE WHEN rn = 1 THEN old_prof_id ELSE gen_random_uuid() END AS new_prof_id
FROM (
  SELECT pair.old_prof_id,
         pair.root_id,
         ROW_NUMBER() OVER (
           PARTITION BY pair.old_prof_id
           ORDER BY lr.root_created_at, pair.root_id
         ) AS rn
  FROM (SELECT DISTINCT m.old_prof_id, m.root_id FROM tmp_level_map m) pair
  JOIN tmp_level_root lr ON lr.root_id = pair.root_id
) ranked;

INSERT INTO "professors" ("id", "field_id", "full_name", "phone", "email", "user_id", "is_active", "created_at")
SELECT pm.new_prof_id, fm.new_field_id,
       p."full_name", p."phone", p."email", p."user_id", p."is_active", p."created_at"
FROM tmp_prof_map pm
JOIN "professors" p ON p."id" = pm.old_prof_id
JOIN tmp_field_map fm ON fm.root_id = pm.root_id AND fm.old_field_id = p."field_id"
WHERE pm.rn > 1;

UPDATE "professors" p
SET "field_id" = fm.new_field_id
FROM tmp_prof_map pm
JOIN tmp_field_map fm ON fm.root_id = pm.root_id
WHERE pm.rn = 1
  AND pm.old_prof_id = p."id"
  AND fm.old_field_id = p."field_id";

-- A group now hangs off the professor row for its old level.
UPDATE "groups" g
SET "prof_id" = pm.new_prof_id
FROM tmp_level_map m
JOIN tmp_prof_map pm ON pm.old_prof_id = m.old_prof_id AND pm.root_id = m.root_id
WHERE g."level_id" = m.old_level_id;

-- Groups lose their level and hang off a professor instead. This has to happen
-- before the merged-away levels are deleted, or the old foreign key blocks them.
DROP INDEX "groups_level_id_idx";
ALTER TABLE "groups" DROP CONSTRAINT "groups_level_id_fkey";
ALTER TABLE "groups" DROP COLUMN "level_id";

ALTER TABLE "groups" ALTER COLUMN "prof_id" SET NOT NULL;
ALTER TABLE "groups" ADD CONSTRAINT "groups_prof_id_fkey"
  FOREIGN KEY ("prof_id") REFERENCES "professors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "groups_prof_id_idx" ON "groups"("prof_id");

-- Levels lose their parent and become roots.
DROP INDEX "levels_prof_id_idx";
ALTER TABLE "levels" DROP CONSTRAINT "levels_prof_id_fkey";
ALTER TABLE "levels" DROP COLUMN "prof_id";

DELETE FROM "levels" WHERE "id" NOT IN (SELECT root_id FROM tmp_level_root);

-- A field nobody has taught a level in yet still needs a home.
INSERT INTO "levels" ("id", "name", "is_active")
SELECT gen_random_uuid(), 'General', TRUE
WHERE EXISTS (SELECT 1 FROM "fields" WHERE "level_id" IS NULL)
  AND NOT EXISTS (SELECT 1 FROM "levels");

UPDATE "fields"
SET "level_id" = (SELECT "id" FROM "levels" ORDER BY "created_at", "id" LIMIT 1)
WHERE "level_id" IS NULL;

ALTER TABLE "fields" ALTER COLUMN "level_id" SET NOT NULL;
ALTER TABLE "fields" ADD CONSTRAINT "fields_level_id_fkey"
  FOREIGN KEY ("level_id") REFERENCES "levels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "fields_level_id_idx" ON "fields"("level_id");

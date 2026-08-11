import { hash } from "bcryptjs";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { seedClient } from "../db/seed-util";
import { users, systemSettings, financialSettings } from "../db/schema";

const { db, close } = seedClient();

/**
 * Seeds the single super_admin operator. Idempotent — safe to re-run.
 * Credentials come from the environment, which the setup wizard generates on
 * first run from the school name — nothing academy-specific is hard-coded.
 */
async function main() {
  const schoolName = process.env.SCHOOL_NAME?.trim();
  const email = process.env.SEED_ADMIN_EMAIL ?? (schoolName ? `admin@${slugify(schoolName)}.com` : "admin@school.local");
  const password = process.env.SEED_ADMIN_PASSWORD ?? "change_me_password";
  const fullName = process.env.SEED_ADMIN_NAME ?? (schoolName ? `${schoolName} Administrator` : "School Administrator");
  const rounds = Number(process.env.BCRYPT_ROUNDS ?? 10);

  const password_hash = await hash(password, rounds);

  let user = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (!user) {
    [user] = await db
      .insert(users)
      .values({
        id: randomUUID(),
        full_name: fullName,
        email,
        password_hash,
        role: "super_admin",
        updated_at: new Date(),
      })
      .returning();
  }

  // On a fresh install the school name also lands in the shared settings rows
  // the UI reads (login screen, sidebar, receipts). Only when explicitly set —
  // an existing installation's real data is never overwritten.
  if (schoolName) {
    await db
      .insert(systemSettings)
      .values({ singleton: "global", system_name: schoolName, updated_at: new Date() })
      .onConflictDoUpdate({ target: systemSettings.singleton, set: { system_name: schoolName, updated_at: new Date() } });
    await db
      .insert(financialSettings)
      .values({ singleton: "global", academy_name: schoolName, updated_at: new Date() })
      .onConflictDoUpdate({ target: financialSettings.singleton, set: { academy_name: schoolName, updated_at: new Date() } });
    console.log(`School identity set: ${schoolName}`);
  }

  console.log(`Seed complete: super_admin ${user.email} (${user.id})`);
  if (!process.env.SEED_ADMIN_PASSWORD) {
    console.warn("  ⚠ Using the default dev password — set SEED_ADMIN_PASSWORD before deploying.");
  }
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "school"
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await close();
  });
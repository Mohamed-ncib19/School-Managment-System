import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

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

  const user = await prisma.users.upsert({
    where: { email },
    update: {},
    create: { full_name: fullName, email, password_hash, role: "super_admin" },
  });

  // On a fresh install the school name also lands in the shared settings rows
  // the UI reads (login screen, sidebar, receipts). Only when explicitly set —
  // an existing installation's real data is never overwritten.
  if (schoolName) {
    await prisma.system_settings.upsert({
      where: { singleton: "global" },
      update: { system_name: schoolName },
      create: { singleton: "global", system_name: schoolName },
    });
    await prisma.financial_settings.upsert({
      where: { singleton: "global" },
      update: { academy_name: schoolName },
      create: { singleton: "global", academy_name: schoolName },
    });
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
    await prisma.$disconnect();
  });

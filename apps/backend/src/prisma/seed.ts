import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

/**
 * Seeds the single super_admin operator. Idempotent — safe to re-run.
 * Credentials are overridable so a real deployment never inherits the dev default.
 */
async function main() {
  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@iqacademy.com";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "admin123";
  const fullName = process.env.SEED_ADMIN_NAME ?? "Super Admin";
  const rounds = Number(process.env.BCRYPT_ROUNDS ?? 10);

  const password_hash = await hash(password, rounds);

  const user = await prisma.users.upsert({
    where: { email },
    update: {},
    create: { full_name: fullName, email, password_hash, role: "super_admin" },
  });

  console.log(`Seed complete: super_admin ${user.email} (${user.id})`);
  if (password === "admin123") {
    console.warn("  ⚠ Using the default dev password — set SEED_ADMIN_PASSWORD before deploying.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

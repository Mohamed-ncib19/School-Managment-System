import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_HIERARCHY = {
  name: "Default Hierarchy",
  entityOrder: ["level", "field", "professor", "group", "student"],
  isDefault: true,
  isActive: true,
};

async function main() {
  console.log("Seeding hierarchy configuration...");

  const existing = await prisma.hierarchy_configurations.findFirst({
    where: { isDefault: true },
  });

  if (existing) {
    console.log("Default hierarchy configuration already exists, updating...");
    await prisma.hierarchy_configurations.update({
      where: { id: existing.id },
      data: {
        entityOrder: DEFAULT_HIERARCHY.entityOrder,
        isActive: true,
      },
    });
    console.log("Updated default hierarchy configuration.");
  } else {
    await prisma.hierarchy_configurations.create({
      data: DEFAULT_HIERARCHY,
    });
    console.log("Created default hierarchy configuration.");
  }

  console.log("Hierarchy configuration seeded successfully.");
}

main()
  .catch((e) => {
    console.error("Error seeding hierarchy configuration:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

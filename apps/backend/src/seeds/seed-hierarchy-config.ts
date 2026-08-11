import { eq } from "drizzle-orm";
import { seedClient } from "../db/seed-util";
import { hierarchyConfigurations } from "../db/schema";

const { db, close } = seedClient();

const DEFAULT_HIERARCHY = {
  name: "Default Hierarchy",
  entity_order: ["level", "field", "professor", "group", "student"] as unknown,
  is_default: true,
  is_active: true,
  updated_at: new Date(),
};

async function main() {
  console.log("Seeding hierarchy configuration...");

  const existing = await db.query.hierarchyConfigurations.findFirst({
    where: eq(hierarchyConfigurations.is_default, true),
  });

  if (existing) {
    console.log("Default hierarchy configuration already exists, updating...");
    await db
      .update(hierarchyConfigurations)
      .set({ entity_order: DEFAULT_HIERARCHY.entity_order, is_active: true })
      .where(eq(hierarchyConfigurations.id, existing.id));
    console.log("Updated default hierarchy configuration.");
  } else {
    await db.insert(hierarchyConfigurations).values(DEFAULT_HIERARCHY);
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
    await close();
  });
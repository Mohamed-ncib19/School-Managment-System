import { BadRequestException } from "@nestjs/common";
import { CloudBackupController } from "../cloud-backup.controller";

function controllerWithDb() {
  const sets: Array<Record<string, unknown>> = [];
  const db = {
    client: {
      query: { cloudTargets: { findFirst: async () => null } },
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: async () => {
            sets.push(values);
          },
        }),
      }),
    },
  };
  const controller = new CloudBackupController(
    db as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { controller, sets };
}

describe("cloud auto/manual settings", () => {
  it("persists the autoExport switch", async () => {
    const { controller, sets } = controllerWithDb();
    await expect(controller.updateSettings({ autoExport: false })).resolves.toEqual({
      ok: true,
      autoExport: false,
    });
    expect(sets).toEqual([{ auto_export: false }]);
  });

  it("rejects non-boolean values", async () => {
    const { controller, sets } = controllerWithDb();
    await expect(controller.updateSettings({ autoExport: "yes" as never })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(sets).toEqual([]);
  });
});

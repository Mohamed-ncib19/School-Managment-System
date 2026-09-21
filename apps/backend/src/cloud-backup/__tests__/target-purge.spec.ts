import { NotFoundException } from "@nestjs/common";
import { CloudBackupController } from "../cloud-backup.controller";
import { backupManifest } from "../../db/schema";

function controllerWithRow(row: { id: string; enabled: boolean; config_ref: string } | null) {
  const calls = { updated: false, credsDeleted: false };
  const deletedTables: string[] = [];
  const db = {
    client: {
      query: { cloudTargets: { findFirst: async () => row } },
      update: () => ({ set: () => ({ where: async () => { calls.updated = true; } }) }),
      delete: (table: object) => ({
        where: async () => {
          deletedTables.push(table === backupManifest ? "manifest" : "target");
        },
      }),
    },
  };
  const creds = { delete: async () => { calls.credsDeleted = true; } };
  const controller = new CloudBackupController(
    db as never,
    {} as never,
    {} as never,
    creds as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { controller, calls, deletedTables };
}

describe("cloud target two-step delete", () => {
  it("first delete retires an enabled target without removing the row", async () => {
    const { controller, calls, deletedTables } = controllerWithRow({ id: "t1", enabled: true, config_ref: "ref1" });
    await expect(controller.deleteTarget("t1")).resolves.toEqual({ ok: true });
    expect(calls.updated).toBe(true);
    expect(deletedTables).toEqual([]);
    expect(calls.credsDeleted).toBe(true);
  });

  it("second delete purges an already-disabled target", async () => {
    const { controller, calls, deletedTables } = controllerWithRow({ id: "t2", enabled: false, config_ref: "ref2" });
    await expect(controller.deleteTarget("t2")).resolves.toEqual({ ok: true, purged: true });
    expect(calls.updated).toBe(false);
    expect(deletedTables).toEqual(["manifest", "target"]);
    expect(calls.credsDeleted).toBe(true);
  });

  it("unknown id throws", async () => {
    const { controller } = controllerWithRow(null);
    await expect(controller.deleteTarget("missing")).rejects.toBeInstanceOf(NotFoundException);
  });
});

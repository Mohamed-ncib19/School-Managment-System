import { BadRequestException } from "@nestjs/common";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RestoreService } from "../restore/restore.service";
import { RestoreThrottleGuard } from "../restore/restore-throttle.guard";

function serviceWithState(setupComplete: boolean): RestoreService {
  const db = {
    client: {
      query: {
        cloudState: { findFirst: async () => ({ setup_complete: setupComplete }) },
        restoreProgress: {
          findFirst: async () => ({
            job_id: "j1",
            snapshot_key: "k",
            applied_through_seq: 0,
            state: "replayed",
          }),
        },
      },
      delete: () => ({ where: async () => undefined }),
    },
  };
  return new RestoreService(db as never, {} as never, {} as never);
}

const target = { driverId: "s3", config: {} };

describe("restore refuses to run against a live install", () => {
  it.each([
    ["applySnapshot", (s: RestoreService) => s.applySnapshot("j1", target, "ecole", "phrase")],
    ["replayEvents", (s: RestoreService) => s.replayEvents("j1", target, "ecole", "phrase")],
    ["finishRestore", (s: RestoreService) => s.finishRestore("j1", target, "ecole", "phrase")],
    ["cancel", (s: RestoreService) => s.cancel("j1")],
  ])("%s throws when setup_complete is true", async (_name, call) => {
    // Only startRestore used to check. The other four were reachable
    // unauthenticated and would run psql over a live school database.
    await expect(call(serviceWithState(true))).rejects.toBeInstanceOf(BadRequestException);
  });

  it("startRestore still throws when setup_complete is true", async () => {
    await expect(
      serviceWithState(true).startRestore({ target, schoolId: "ecole", phrase: "phrase" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("restore throttle", () => {
  const ctxFor = (ip: string) =>
    ({ getType: () => "http", switchToHttp: () => ({ getRequest: () => ({ ip }) }) }) as never;

  it("allows the first attempts and then rejects the burst", () => {
    const guard = new RestoreThrottleGuard();
    for (let i = 0; i < 5; i++) expect(guard.canActivate(ctxFor("10.0.0.9"))).toBe(true);
    expect(() => guard.canActivate(ctxFor("10.0.0.9"))).toThrow();
  });

  it("tracks callers independently", () => {
    const guard = new RestoreThrottleGuard();
    for (let i = 0; i < 5; i++) guard.canActivate(ctxFor("10.0.0.1"));
    expect(guard.canActivate(ctxFor("10.0.0.2"))).toBe(true);
  });

  it("is applied to every restore route that does real work", () => {
    const controller = readFileSync(join(__dirname, "..", "cloud-backup.controller.ts"), "utf8");
    expect((controller.match(/@UseGuards\(RestoreThrottleGuard\)/g) ?? []).length).toBe(5);
  });
});

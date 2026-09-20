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

    // A hard count used to stand here, and it broke the moment a route was
    // added — reporting a failure when the code had become *more* protected.
    // Assert the property instead. Every POST under restore/ does real work:
    // it starts a job, applies a snapshot, replays events, or mints an OAuth
    // url. The two unguarded restore routes are GETs that read a flag.
    // Tolerate CRLF checkouts: split on blank lines whatever the line endings.
    const members = controller.split(/\r?\n\r?\n(?=  @)/);
    const writes = members.filter((m) => /@Post\("restore\//.test(m));

    expect(writes.length).toBeGreaterThanOrEqual(5);
    const unguarded = writes
      // Substring, not the full decorator: the throttle is now composed with
      // the loopback gate — `@UseGuards(RestoreLoopbackGuard, RestoreThrottleGuard)`
      // — and the property under test is throttling, not decorator spelling.
      .filter((m) => !m.includes("RestoreThrottleGuard"))
      .map((m) => m.match(/async (\w+)\(/)?.[1] ?? "(unnamed)");
    expect(unguarded).toEqual([]);
  });});

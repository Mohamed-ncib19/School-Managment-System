import { readFileSync } from "node:fs";
import { join } from "node:path";
import { withActor, withSyncDisabled } from "../queue/sync-context";

const MODULE = readFileSync(join(__dirname, "..", "cloud-backup.module.ts"), "utf8");
const CONTEXT = readFileSync(join(__dirname, "..", "queue", "sync-context.ts"), "utf8");

function recordingDb(calls: string[]) {
  return {
    client: {
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        calls.push("begin");
        const tx = {
          execute: async (q: unknown) => {
            calls.push(`execute:${JSON.stringify(q)?.slice(0, 40) ?? "sql"}`);
          },
        };
        const result = await fn(tx);
        calls.push("commit");
        return result;
      },
    },
  };
}

describe("sync actor attribution", () => {
  it("leaves no unregistered interceptor behind", () => {
    // SyncActorInterceptor was declared and registered in no module at all,
    // so app.actor_user_id was never set and every queue row had a null actor.
    const declaresInterceptor = CONTEXT.includes("SyncActorInterceptor");
    if (declaresInterceptor) expect(MODULE).toContain("SyncActorInterceptor");
    else expect(MODULE).not.toContain("SyncActorInterceptor");
  });

  it("never interpolates the actor id into SQL", () => {
    expect(CONTEXT).not.toMatch(/set_config\('app\.actor_user_id',\s*'\$\{/);
  });

  it("sets the actor transaction-locally, not session-wide", () => {
    // Third argument true = is_local. Session scope on a pooled connection
    // leaked one request's actor into the next request on that connection.
    expect(CONTEXT).toMatch(/app\.actor_user_id[\s\S]{0,60}true/);
  });

  it("runs its callback inside one transaction", async () => {
    const calls: string[] = [];
    await withActor(recordingDb(calls) as never, "11111111-1111-1111-1111-111111111111", async () => "done");

    expect(calls[0]).toBe("begin");
    expect(calls[calls.length - 1]).toBe("commit");
    expect(calls.some((c) => c.startsWith("execute:"))).toBe(true);
  });

  it("rejects an actor id that is not a UUID", async () => {
    const calls: string[] = [];
    await expect(
      withActor(recordingDb(calls) as never, "'; DROP TABLE users; --", async () => "x"),
    ).rejects.toThrow(/actor id/i);
  });

  it("withSyncDisabled still wraps its callback in a transaction", async () => {
    const calls: string[] = [];
    const result = await withSyncDisabled(recordingDb(calls) as never, async () => "ok");
    expect(result).toBe("ok");
    expect(calls[0]).toBe("begin");
    expect(calls[calls.length - 1]).toBe("commit");
  });
});

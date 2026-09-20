import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RestoreLoopbackGuard, isLoopback } from "../restore/restore-loopback.guard";

const ctxFor = (opts: { ip?: string; forwarded?: string }) =>
  ({
    getType: () => "http",
    switchToHttp: () => ({
      getRequest: () => ({
        ip: opts.ip,
        socket: { remoteAddress: opts.ip },
        headers: opts.forwarded === undefined ? {} : { "x-forwarded-for": opts.forwarded },
      }),
    }),
  }) as never;

describe("isLoopback", () => {
  it.each([
    ["127.0.0.1", true],
    ["127.9.9.9", true],
    ["::1", true],
    ["::ffff:127.0.0.1", true],
    ["192.168.1.50", false],
    ["10.0.0.7", false],
    ["::ffff:192.168.1.50", false],
    ["fe80::1", false],
    ["", false],
  ])("classifies %s as %p", (address, expected) => {
    expect(isLoopback(address)).toBe(expected);
  });
});

describe("restore loopback gate", () => {
  it("admits a request from the server's own machine", () => {
    expect(new RestoreLoopbackGuard().canActivate(ctxFor({ ip: "127.0.0.1" }))).toBe(true);
    expect(new RestoreLoopbackGuard().canActivate(ctxFor({ ip: "::1" }))).toBe(true);
  });

  it("admits the portal's proxied request (loopback socket, loopback first hop)", () => {
    expect(
      new RestoreLoopbackGuard().canActivate(ctxFor({ ip: "127.0.0.1", forwarded: "127.0.0.1" })),
    ).toBe(true);
    expect(
      new RestoreLoopbackGuard().canActivate(ctxFor({ ip: "127.0.0.1", forwarded: "127.0.0.1, 127.0.0.1" })),
    ).toBe(true);
  });

  it("refuses a LAN client hitting the API directly, whatever headers it writes", () => {
    // A hand-written X-Forwarded-For cannot rescue a non-loopback socket.
    expect(() => new RestoreLoopbackGuard().canActivate(ctxFor({ ip: "192.168.1.66" }))).toThrow();
    expect(() =>
      new RestoreLoopbackGuard().canActivate(ctxFor({ ip: "192.168.1.66", forwarded: "127.0.0.1" })),
    ).toThrow();
  });

  it("refuses a proxied request whose real browser address is on the LAN", () => {
    // The portal forwarded a request whose first hop is the client's own
    // address: a browser on the wifi, reaching :3000. Restores stay local.
    expect(() =>
      new RestoreLoopbackGuard().canActivate(ctxFor({ ip: "127.0.0.1", forwarded: "192.168.1.66" })),
    ).toThrow();
  });

  it("refuses an empty address rather than defaulting open", () => {
    expect(() => new RestoreLoopbackGuard().canActivate(ctxFor({ ip: "" }))).toThrow();
  });
});

describe("wiring", () => {
  it("every restore route carries the loopback gate beside the throttle", () => {
    const controller = readFileSync(join(__dirname, "..", "cloud-backup.controller.ts"), "utf8");
    const members = controller.split(/\r?\n\r?\n(?=  @)/);
    const restoreRoutes = members.filter((m) => /@(Get|Post)\("restore\//.test(m));
    // One unthrottled route carries the loopback gate alone; the rest carry
    // both guards. None may be missing the loopback gate.
    expect(restoreRoutes.length).toBeGreaterThanOrEqual(8);
    const unguarded = restoreRoutes
      .filter((m) => !m.includes("@UseGuards(RestoreLoopbackGuard"))
      .map((m) => m.match(/async (\w+)\(/)?.[1] ?? "(unnamed)");
    expect(unguarded).toEqual([]);
  });
});

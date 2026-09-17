import { ForbiddenException } from "@nestjs/common";
import { RolesGuard } from "../roles.guard";

const ctxFor = (user: unknown) =>
  ({
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as never;

const reflectorFor = (roles: string[] | undefined) =>
  ({ getAllAndOverride: () => roles }) as never;

describe("RolesGuard", () => {
  it("allows the request when no roles are required", () => {
    const guard = new RolesGuard(reflectorFor(undefined));
    expect(guard.canActivate(ctxFor({ role: "anything" }))).toBe(true);
  });

  it("allows a user holding the required role", () => {
    const guard = new RolesGuard(reflectorFor(["super_admin"]));
    expect(guard.canActivate(ctxFor({ role: "super_admin" }))).toBe(true);
  });

  it("rejects a user without the required role (backup/imports stay admin-only)", () => {
    const guard = new RolesGuard(reflectorFor(["super_admin"]));
    expect(() => guard.canActivate(ctxFor({ role: "prof" }))).toThrow(ForbiddenException);
  });

  it("rejects when there is no user on the request", () => {
    const guard = new RolesGuard(reflectorFor(["super_admin"]));
    expect(() => guard.canActivate(ctxFor(undefined))).toThrow(ForbiddenException);
  });
});

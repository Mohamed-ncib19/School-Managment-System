import { Test } from "@nestjs/testing";
import { HealthController } from "../health.controller";

describe("health", () => {
  it("returns ok", () => {
    const ctrl = new HealthController();
    expect(ctrl.health()).toEqual({ status: "ok" });
  });
});

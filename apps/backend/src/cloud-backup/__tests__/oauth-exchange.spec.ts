import { CloudBackupController } from "../cloud-backup.controller";

const controllerWith = (pending: Map<string, any>): CloudBackupController => {
  const ctrl = Object.create(CloudBackupController.prototype) as CloudBackupController;
  (ctrl as any).pendingOAuth = pending;
  return ctrl;
};

describe("manual OAuth code exchange", () => {
  it("rejects an unknown handshake state", async () => {
    const ctrl = controllerWith(new Map());
    await expect((ctrl as any).exchangeOAuthCode({ state: "nope", code: "abc" })).rejects.toThrow(
      /invalide/,
    );
  });

  it("rejects a missing code", async () => {
    const ctrl = controllerWith(
      new Map([["s1", { provider: "gdrive", createdAt: Date.now() }]]),
    );
    await expect((ctrl as any).exchangeOAuthCode({ state: "s1", code: "  " })).rejects.toThrow(
      /invalide/,
    );
  });

  it("rejects an expired handshake instead of exchanging it", async () => {
    const ctrl = controllerWith(
      new Map([
        [
          "old",
          {
            clientId: "id",
            clientSecret: "secret",
            redirectUri: "http://localhost:3000/x",
            provider: "gdrive",
            createdAt: Date.now() - 11 * 60_000,
          },
        ],
      ]),
    );
    await expect((ctrl as any).exchangeOAuthCode({ state: "old", code: "abc" })).rejects.toThrow(
      /expiré/,
    );
  });

  it("consumes the handshake even when it fails", async () => {
    const pending = new Map();
    const ctrl = controllerWith(pending);
    await expect((ctrl as any).exchangeOAuthCode({ state: "nope", code: "abc" })).rejects.toThrow();
    expect(pending.has("nope")).toBe(false);
  });
});

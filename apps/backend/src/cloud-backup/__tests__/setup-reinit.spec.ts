import { BadRequestException } from "@nestjs/common";
import { CloudSetupService } from "../setup/setup.service";
import { buildKdfParams, newSalt } from "../crypto/kdf";

const EXISTING_KDF = buildKdfParams("scrypt", newSalt(), { scryptN: 1024 });
const PHRASE = "abandon ability able about above absent absorb abstract absurd abuse access accident";

function makeService(existing: Record<string, unknown> | null) {
  const updates: Array<Record<string, unknown>> = [];
  const db = {
    client: {
      query: { cloudState: { findFirst: async () => existing } },
      update: () => ({ set: (v: Record<string, unknown>) => ({ where: async () => updates.push(v) }) }),
      insert: () => ({ values: async (v: Record<string, unknown>) => updates.push(v) }),
      select: () => ({ from: () => ({ where: async () => [] }) }),
    },
  };
  const keys = {
    wrapFromPhrase: async () => ({ wrapped: "w", wrapSalt: "s" }),
    unwrap: async () => Buffer.alloc(32, 1),
  };
  const service = new CloudSetupService(
    db as never,
    keys as never,
    { load: async () => null } as never,
    { enabledTargets: async () => [{ id: "t", driver: { put: async () => ({ key: "", size: 0 }) } }] } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, updates };
}

const CONFIGURED = {
  setup_complete: true,
  kdf_salt: JSON.stringify(EXISTING_KDF),
  wrapped_key: "existing",
  wrap_salt: "existing",
};

describe("re-running setup step 1", () => {
  it("refuses on a configured install without explicit confirmation", async () => {
    const { service } = makeService(CONFIGURED);
    await expect(service.step1({ schoolId: "ecole-test", phrase: PHRASE })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("names the consequence in the error", async () => {
    const { service } = makeService(CONFIGURED);
    await expect(service.step1({ schoolId: "ecole-test", phrase: PHRASE })).rejects.toThrow(
      /illisibles|historique|irréversible/i,
    );
  });

  it("still refuses when confirmation is explicitly false", async () => {
    const { service } = makeService(CONFIGURED);
    await expect(
      service.step1({ schoolId: "ecole-test", phrase: PHRASE, confirmReplaceExisting: false }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects an invalid school id before touching anything", async () => {
    const { service, updates } = makeService(null);
    await expect(service.step1({ schoolId: "!!!", phrase: PHRASE })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(updates).toHaveLength(0);
  });

  it("slugifies an accented name instead of rejecting it", async () => {
    const { service } = makeService(null);
    const result = await service.step1({ schoolId: "École Saint-Jean", phrase: PHRASE });
    expect(result.schoolId).toBe("ecole-saint-jean");
  });
});

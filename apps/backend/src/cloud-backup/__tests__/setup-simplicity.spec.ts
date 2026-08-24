import { slugifySchoolId, isValidSchoolId } from "../setup/school-id";
import { DRIVER_DEFINITIONS } from "../drivers/driver-registry";
import { S3_PRESETS } from "../drivers/s3-presets";

describe("school id is derived, not demanded", () => {
  it.each([
    ["IQ Academy", "iq-academy"],
    ["École Primaire Saint-Jean", "ecole-primaire-saint-jean"],
    ["Lycée Français", "lycee-francais"],
    ["  Collège   Molière  ", "college-moliere"],
    ["École", "ecole"],
  ])("turns %j into %j", (name, expected) => {
    expect(slugifySchoolId(name)).toBe(expected);
  });

  it("keeps the letters accents sit on", () => {
    // Naive slugging drops the vowel and yields "cole".
    expect(slugifySchoolId("École")).toBe("ecole");
    expect(slugifySchoolId("Établissement Créatif")).toBe("etablissement-creatif");
  });

  it("produces ids the wizard's own validation accepts", () => {
    for (const name of ["IQ Academy", "École Primaire Saint-Jean", "A B", "Groupe Scolaire 12"]) {
      const slug = slugifySchoolId(name);
      expect(isValidSchoolId(slug)).toBe(true);
    }
  });

  it("pads a name too short to be a valid id", () => {
    expect(slugifySchoolId("A")).toBe("ecole-a");
    expect(isValidSchoolId(slugifySchoolId("A"))).toBe(true);
  });

  it("returns empty for a name with nothing usable in it", () => {
    expect(slugifySchoolId("")).toBe("");
    expect(slugifySchoolId("！！！")).toBe("");
  });

  it("never exceeds the 64-character limit", () => {
    const slug = slugifySchoolId("x".repeat(200));
    expect(slug.length).toBeLessThanOrEqual(64);
    expect(isValidSchoolId(slug)).toBe(true);
  });

  it("never ends in a separator", () => {
    expect(slugifySchoolId("École Primaire !!!")).not.toMatch(/-$/);
  });
});

describe("the picker offers free options first", () => {
  const recommended = DRIVER_DEFINITIONS.filter((d) => d.recommended);

  it("recommends exactly the two that need no account or no card", () => {
    expect(recommended.map((d) => d.id).sort()).toEqual(["folder", "gdrive"]);
  });

  it("states the cost on every recommended card", () => {
    for (const def of recommended) {
      expect(def.freeTier).toBeTruthy();
    }
  });

  it("no longer offers a provider without a free tier", () => {
    // Wasabi has a 30-day trial and no free tier; it was removed on purpose.
    expect(S3_PRESETS.map((p) => p.id)).not.toContain("wasabi");
    for (const def of DRIVER_DEFINITIONS) {
      expect(def.displayName.toLowerCase()).not.toContain("wasabi");
    }
  });

  it("is honest that Cloudflare R2 asks for a card", () => {
    const r2 = S3_PRESETS.find((p) => p.id === "r2")!;
    expect(`${r2.description} ${r2.freeTier ?? ""}`.toLowerCase()).toContain("carte");
  });

  it("keeps the expert escape hatch reachable but unrecommended", () => {
    const generic = DRIVER_DEFINITIONS.find((d) => d.id === "s3")!;
    expect(generic.recommended ?? false).toBe(false);
  });
});

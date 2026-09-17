import { slugifySchoolId, isValidSchoolId } from "../setup/school-id";
import { DRIVER_DEFINITIONS, isRecommended } from "../drivers/driver-registry";
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

  // isRecommended() reads the environment at call time, so the test below
  // has to set it. Snapshot and restore rather than delete: a developer with
  // real credentials in their shell must not have this suite change what the
  // next one sees.
  const OAUTH_VARS = [
    "DROPBOX_APP_KEY",
    "DROPBOX_APP_SECRET",
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
  ] as const;
  const saved = new Map<string, string | undefined>();
  beforeAll(() => OAUTH_VARS.forEach((v) => saved.set(v, process.env[v])));
  afterAll(() =>
    OAUTH_VARS.forEach((v) => {
      const was = saved.get(v);
      if (was === undefined) delete process.env[v];
      else process.env[v] = was;
    }),
  );

  it("leads with what always works and gates the one-click clouds on credentials", () => {
    const promoted = () =>
      DRIVER_DEFINITIONS.filter((d) => isRecommended(d))
        .map((d) => d.id)
        .sort();

    // Without publisher credentials a connect button can only return an
    // error, so neither cloud may head the list — it would be a door that
    // does not open. A folder always works.
    delete process.env.DROPBOX_APP_KEY;
    delete process.env.DROPBOX_APP_SECRET;
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    expect(promoted()).toEqual(["folder"]);

    // Dropbox joins the folder as soon as its app credentials are set.
    process.env.DROPBOX_APP_KEY = "app-key";
    process.env.DROPBOX_APP_SECRET = "app-secret";
    expect(promoted()).toEqual(["dropbox", "folder"]);

    // Drive joins too once credentials exist (publisher or self-hosted) — it
    // is offered after Dropbox in the UI: same one-click, but Google gates
    // unreviewed apps behind test users. The sorted expectation below is
    // alphabetical.
    process.env.GOOGLE_OAUTH_CLIENT_ID = "id.apps.googleusercontent.com";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "client-secret";
    expect(promoted()).toEqual(["dropbox", "folder", "gdrive"]);
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

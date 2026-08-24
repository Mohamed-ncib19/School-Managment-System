import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  appGoogleOAuth,
  hasAppGoogleOAuth,
  withAppGoogleOAuth,
} from "../drivers/google-oauth-app";
import { DRIVER_DEFINITIONS, driverFields } from "../drivers/driver-registry";

const ID = "1234.apps.googleusercontent.com";
const SECRET = "GOCSPX-example";

describe("application Google OAuth client", () => {
  const saved = { id: process.env.GOOGLE_OAUTH_CLIENT_ID, secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET };

  afterEach(() => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = saved.id;
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = saved.secret;
  });

  const configure = (id?: string, secret?: string) => {
    if (id === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    else process.env.GOOGLE_OAUTH_CLIENT_ID = id;
    if (secret === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    else process.env.GOOGLE_OAUTH_CLIENT_SECRET = secret;
  };

  it("is absent until both halves are configured", () => {
    configure(undefined, undefined);
    expect(appGoogleOAuth()).toBeNull();
    configure(ID, undefined);
    expect(appGoogleOAuth()).toBeNull();
    configure(undefined, SECRET);
    expect(appGoogleOAuth()).toBeNull();
  });

  it("is available once both are set", () => {
    configure(ID, SECRET);
    expect(hasAppGoogleOAuth()).toBe(true);
    expect(appGoogleOAuth()).toEqual({ clientId: ID, clientSecret: SECRET });
  });

  it("fills in credentials a config omits", () => {
    configure(ID, SECRET);
    const filled = withAppGoogleOAuth({ refreshToken: "rt" });
    expect(filled).toMatchObject({ refreshToken: "rt", clientId: ID, clientSecret: SECRET });
  });

  it("lets a self-hoster's own client win", () => {
    configure(ID, SECRET);
    const filled = withAppGoogleOAuth({ clientId: "mine", clientSecret: "aussi", refreshToken: "rt" });
    expect(filled.clientId).toBe("mine");
    expect(filled.clientSecret).toBe("aussi");
  });

  it("leaves a config untouched when the app has no client", () => {
    configure(undefined, undefined);
    expect(withAppGoogleOAuth({ refreshToken: "rt" })).toEqual({ refreshToken: "rt" });
  });
});

describe("what the customer is asked to type", () => {
  const gdrive = DRIVER_DEFINITIONS.find((d) => d.id === "gdrive")!;
  const saved = { id: process.env.GOOGLE_OAUTH_CLIENT_ID, secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET };

  afterEach(() => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = saved.id;
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = saved.secret;
  });

  it("shows only the connect button when the app ships a client", () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = ID;
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = SECRET;
    const fields = driverFields(gdrive);
    // A school administrator must never be shown a client id or secret.
    expect(fields.map((f) => f.name)).toEqual(["refreshToken"]);
  });

  it("falls back to the full form for a self-hosted client", () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    expect(driverFields(gdrive).map((f) => f.name)).toEqual(["clientId", "clientSecret", "refreshToken"]);
  });

  it("leaves the other drivers alone", () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = ID;
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = SECRET;
    for (const def of DRIVER_DEFINITIONS.filter((d) => d.id !== "gdrive")) {
      expect(driverFields(def)).toHaveLength(def.fields.length);
    }
  });
});

describe("the OAuth url endpoint", () => {
  const CONTROLLER = readFileSync(join(__dirname, "..", "cloud-backup.controller.ts"), "utf8");

  it("no longer demands a client id and secret from the caller", () => {
    const handler = CONTROLLER.slice(CONTROLLER.indexOf("async gdriveUrl"));
    const body = handler.slice(0, handler.indexOf("\n  @"));
    expect(body).not.toMatch(/!body\.clientId \|\| !body\.clientSecret/);
    expect(body).toContain("appGoogleOAuth()");
  });
});

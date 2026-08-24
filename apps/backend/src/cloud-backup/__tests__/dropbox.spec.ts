import { readFileSync } from "node:fs";
import { join } from "node:path";
import { appDropbox, hasAppDropbox, withAppDropbox } from "../drivers/dropbox-app";
import { DRIVER_DEFINITIONS, driverFields, isRecommended } from "../drivers/driver-registry";

const KEY = "abc123key";
const SECRET = "abc123secret";

function configure(key?: string, secret?: string): void {
  if (key === undefined) delete process.env.DROPBOX_APP_KEY;
  else process.env.DROPBOX_APP_KEY = key;
  if (secret === undefined) delete process.env.DROPBOX_APP_SECRET;
  else process.env.DROPBOX_APP_SECRET = secret;
}

describe("application Dropbox app", () => {
  const saved = { key: process.env.DROPBOX_APP_KEY, secret: process.env.DROPBOX_APP_SECRET };
  afterEach(() => configure(saved.key, saved.secret));

  it("is absent until both halves are configured", () => {
    configure(undefined, undefined);
    expect(appDropbox()).toBeNull();
    configure(KEY, undefined);
    expect(appDropbox()).toBeNull();
  });

  it("fills in credentials a stored config omits", () => {
    configure(KEY, SECRET);
    expect(withAppDropbox({ refreshToken: "rt" })).toMatchObject({
      refreshToken: "rt",
      appKey: KEY,
      appSecret: SECRET,
    });
  });

  it("lets a self-hoster's own app win", () => {
    configure(KEY, SECRET);
    const filled = withAppDropbox({ appKey: "mine", appSecret: "aussi", refreshToken: "rt" });
    expect(filled.appKey).toBe("mine");
  });

  it("leaves a config untouched when no app is configured", () => {
    configure(undefined, undefined);
    expect(withAppDropbox({ refreshToken: "rt" })).toEqual({ refreshToken: "rt" });
  });
});

describe("what the school is asked to type", () => {
  const dropbox = DRIVER_DEFINITIONS.find((d) => d.id === "dropbox")!;
  const saved = { key: process.env.DROPBOX_APP_KEY, secret: process.env.DROPBOX_APP_SECRET };
  afterEach(() => configure(saved.key, saved.secret));

  it("shows only the connect button when the app ships credentials", () => {
    configure(KEY, SECRET);
    expect(driverFields(dropbox).map((f) => f.name)).toEqual(["refreshToken"]);
    expect(hasAppDropbox()).toBe(true);
  });

  it("falls back to the full form for a self-hosted app", () => {
    configure(undefined, undefined);
    expect(driverFields(dropbox).map((f) => f.name)).toEqual(["appKey", "appSecret", "refreshToken"]);
  });

  it("is only a headline option when it can actually work", () => {
    // Otherwise the button offers a door that returns 400.
    configure(KEY, SECRET);
    expect(isRecommended(dropbox)).toBe(true);
    configure(undefined, undefined);
    expect(isRecommended(dropbox)).toBe(false);
  });
});

describe("dropbox driver source", () => {
  const source = readFileSync(join(__dirname, "..", "drivers", "dropbox.driver.ts"), "utf8");

  it("requests a refresh token, not a 4-hour grant", () => {
    const controller = readFileSync(join(__dirname, "..", "cloud-backup.controller.ts"), "utf8");
    // Without token_access_type=offline the backup stops silently a day later.
    expect(controller).toContain("token_access_type");
  });

  it("streams large objects through an upload session", () => {
    // Dropbox rejects a single-shot upload above 150 MB, and a snapshot can
    // exceed it — buffering one whole would also blow up a school PC.
    expect(source).toContain("upload_session/start");
    expect(source).toContain("upload_session/append_v2");
    expect(source).toContain("upload_session/finish");
  });

  it("escapes the API-Arg header without a literal high-character class", () => {
    // A regex class holding literal high characters is invisible in a diff
    // and gets mangled by editors and encoding conversions. This assertion is
    // written without one for exactly that reason.
    // Slice a fixed window rather than searching for a newline: writing
    // one here would need an escape, and escapes are exactly what keeps
    // getting mangled in this file's neighbours.
    const body = source.slice(source.indexOf("function asciiJson")).slice(0, 600);
    expect(body).toContain("codePointAt");
    expect(body).not.toContain(".replace(");
    expect([...body].every((ch) => ch.codePointAt(0)! < 0x80)).toBe(true);
  });

  it("refuses an object key that climbs out of the app folder", () => {
    expect(source).toContain('clean.includes("..")');
  });
});

describe("oauth handshakes cannot be crossed", () => {
  const controller = readFileSync(join(__dirname, "..", "cloud-backup.controller.ts"), "utf8");

  it("tags each pending handshake with its provider", () => {
    expect(controller).toContain('provider: "dropbox"');
    expect(controller).toContain('provider: "gdrive"');
  });

  it("rejects a callback whose state belongs to the other provider", () => {
    expect(controller).toContain('pending.provider !== "dropbox"');
    expect(controller).toContain('pending.provider !== "gdrive"');
  });
});

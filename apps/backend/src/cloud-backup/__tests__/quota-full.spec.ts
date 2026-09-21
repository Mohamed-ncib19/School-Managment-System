import { isDropboxQuotaFull } from "../cloud-backup.controller";

describe("dropbox quota-full detection", () => {
  it("flags the classified French message on dropbox targets", () => {
    expect(
      isDropboxQuotaFull(
        "dropbox",
        "Espace Dropbox insuffisant — libérez de la place ou passez à une offre supérieure.",
      ),
    ).toBe(true);
  });

  it("flags the raw Dropbox tag before classification", () => {
    expect(isDropboxQuotaFull("dropbox", "Dropbox /files/upload (409): insufficient_space")).toBe(true);
  });

  it("ignores other dropbox errors", () => {
    expect(isDropboxQuotaFull("dropbox", "Dropbox injoignable — vérifiez la connexion réseau.")).toBe(false);
  });

  it("ignores null errors and non-dropbox drivers", () => {
    expect(isDropboxQuotaFull("dropbox", null)).toBe(false);
    expect(isDropboxQuotaFull("s3", "Espace Dropbox insuffisant")).toBe(false);
  });
});

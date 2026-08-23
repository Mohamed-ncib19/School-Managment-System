import { parsePgUrl } from "../pg-url";

describe("DATABASE_URL parsing", () => {
  it("parses the standard form", () => {
    expect(parsePgUrl("postgresql://user:pass@localhost:5432/school")).toEqual({
      user: "user",
      password: "pass",
      host: "localhost",
      port: 5432,
      database: "school",
    });
  });

  it("accepts the postgres:// scheme", () => {
    expect(parsePgUrl("postgres://user:pass@localhost:5432/school").database).toBe("school");
  });

  it("defaults the port when it is omitted", () => {
    expect(parsePgUrl("postgresql://user:pass@localhost/school").port).toBe(5432);
  });

  it("decodes a percent-encoded password", () => {
    // The setup wizard generates random passwords; '@' and '/' are encoded.
    expect(parsePgUrl("postgresql://user:p%40ss%2Fword@localhost:5432/school").password).toBe("p@ss/word");
  });

  it("handles a password containing an at sign", () => {
    expect(parsePgUrl("postgresql://user:a%40b@localhost:5432/school")).toMatchObject({
      user: "user",
      password: "a@b",
      host: "localhost",
    });
  });

  it("strips query parameters from the database name", () => {
    expect(parsePgUrl("postgresql://u:p@localhost:5432/school?sslmode=require").database).toBe("school");
  });

  it("rejects something that is not a postgres URL", () => {
    expect(() => parsePgUrl("")).toThrow();
    expect(() => parsePgUrl("mysql://u:p@localhost/db")).toThrow();
    expect(() => parsePgUrl("not a url at all")).toThrow();
  });
});

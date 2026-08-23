import { isAllowedOrigin } from "../cors-origin";

describe("CORS origin policy", () => {
  it("allows the loopback hosts the frontend actually uses", () => {
    expect(isAllowedOrigin("http://localhost:3000", "")).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:3000", "")).toBe(true);
    expect(isAllowedOrigin("http://localhost:3001", "")).toBe(true);
  });

  it("rejects a host that merely CONTAINS a loopback origin", () => {
    // The old regex was unanchored, so any string with the substring passed.
    expect(isAllowedOrigin("http://localhost:3000.evil.example", "")).toBe(false);
    expect(isAllowedOrigin("https://evil.example/http://localhost:3000", "")).toBe(false);
    expect(isAllowedOrigin("http://notlocalhost:3000", "")).toBe(false);
    expect(isAllowedOrigin("", "")).toBe(false);
  });

  it("allows an explicitly configured LAN origin", () => {
    expect(isAllowedOrigin("http://192.168.1.50:3000", "http://192.168.1.50:3000")).toBe(true);
    expect(isAllowedOrigin("http://192.168.1.99:3000", "http://192.168.1.50:3000")).toBe(false);
  });

  it("accepts a comma-separated list with stray whitespace", () => {
    const configured = " http://192.168.1.50:3000 , https://ecole.example ";
    expect(isAllowedOrigin("https://ecole.example", configured)).toBe(true);
    expect(isAllowedOrigin("http://192.168.1.50:3000", configured)).toBe(true);
  });
});

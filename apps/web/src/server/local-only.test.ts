import { describe, expect, it } from "vitest";
import { rejectNonLocal } from "./local-only.ts";

function req(headers: Record<string, string>, method = "POST"): Request {
  return new Request("http://localhost:3000/api/jobs", { method, headers });
}

describe("rejectNonLocal", () => {
  it("lets the app's own same-origin requests through", () => {
    expect(
      rejectNonLocal(req({ host: "localhost:3000", origin: "http://localhost:3000" })),
    ).toBeNull();
    expect(
      rejectNonLocal(req({ host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" })),
    ).toBeNull();
    expect(rejectNonLocal(req({ host: "[::1]:3000" }, "GET"))).toBeNull();
    // curl and other non-browser clients send no Origin.
    expect(rejectNonLocal(req({ host: "localhost:3000" }))).toBeNull();
  });

  it("refuses a cross-site POST (CSRF: no-cors text/plain simple request)", () => {
    const res = rejectNonLocal(req({ host: "localhost:3000", origin: "https://evil.example" }));
    expect(res?.status).toBe(403);
  });

  it("refuses another loopback origin (a different local port is a different site)", () => {
    const res = rejectNonLocal(req({ host: "localhost:3000", origin: "http://localhost:8080" }));
    expect(res?.status).toBe(403);
  });

  it("refuses the opaque null origin", () => {
    expect(rejectNonLocal(req({ host: "localhost:3000", origin: "null" }))?.status).toBe(403);
  });

  it("refuses a DNS-rebinding request: same-origin to the browser, foreign Host", () => {
    expect(rejectNonLocal(req({ host: "evil.example:3000" }, "GET"))?.status).toBe(403);
    expect(
      rejectNonLocal(req({ host: "evil.example:3000", origin: "http://evil.example:3000" }))
        ?.status,
    ).toBe(403);
  });

  it("refuses LAN addresses and look-alike hosts", () => {
    for (const host of [
      "192.168.1.20:3000",
      "localhost.evil.example",
      "evil@localhost:3000",
      "localhost.:3000",
    ]) {
      expect(rejectNonLocal(req({ host }, "GET"))?.status, host).toBe(403);
    }
  });
});

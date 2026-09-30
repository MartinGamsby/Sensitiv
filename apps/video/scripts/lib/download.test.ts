import { describe, expect, it } from "vitest";
import { IMAGE_TYPES, download, eachLimit } from "./download.ts";

// No network: every response here comes from a fake fetch.
function fakeFetch(body: Uint8Array, contentType: string, status = 200) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(new Blob([new Uint8Array(body)]), {
      status,
      headers: { "content-type": contentType },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("download", () => {
  it("returns the bytes and the extension for an allowlisted type", async () => {
    const { impl, calls } = fakeFetch(new Uint8Array([1, 2, 3]), "image/jpeg; charset=binary");
    const got = await download("https://example.com/a.jpg", { types: IMAGE_TYPES, maxBytes: 10, fetchImpl: impl });
    expect(got.ext).toBe("jpg");
    expect([...got.bytes]).toEqual([1, 2, 3]);
    // Never follows a redirect off the approved host.
    expect(calls[0]!.init?.redirect).toBe("error");
  });

  it("refuses SVG, which can carry script", async () => {
    const { impl } = fakeFetch(new TextEncoder().encode("<svg/>"), "image/svg+xml");
    await expect(
      download("https://example.com/a.svg", { types: IMAGE_TYPES, maxBytes: 100, fetchImpl: impl }),
    ).rejects.toThrow(/unexpected content type/);
  });

  it("stops reading at the size cap", async () => {
    const { impl } = fakeFetch(new Uint8Array(64), "image/png");
    await expect(
      download("https://example.com/a.png", { types: IMAGE_TYPES, maxBytes: 16, fetchImpl: impl }),
    ).rejects.toThrow(/larger than/);
  });

  it("reports an HTTP error as a download error", async () => {
    const { impl } = fakeFetch(new Uint8Array(0), "text/html", 403);
    await expect(
      download("https://example.com/a.png", { types: IMAGE_TYPES, maxBytes: 16, fetchImpl: impl }),
    ).rejects.toThrow(/HTTP 403/);
  });
});

describe("eachLimit", () => {
  it("never runs more than `limit` tasks at once, and runs them all", async () => {
    let running = 0;
    let peak = 0;
    const done: number[] = [];
    await eachLimit([1, 2, 3, 4, 5, 6, 7], 2, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 1));
      done.push(n);
      running--;
    });
    expect(peak).toBe(2);
    expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

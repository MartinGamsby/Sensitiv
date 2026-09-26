import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createJob,
  getOrCreateLocalUser,
  schema,
  upsertPlace,
  type Database,
} from "@sensitiv/db";
import { __setWebDeps } from "../../../../../../../server/deps.ts";
import { makeTestDb } from "../../../../../../../test-support/db.ts";
import { testEnv } from "../../../../../../../test-support/env.ts";
import { GET } from "./route.ts";

let handle: Database;
let upstream: ReturnType<typeof vi.fn>;
let requested: Array<{ url: string; redirect?: string }>;
let logSpies: Array<ReturnType<typeof vi.spyOn>>;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function imageResponse(
  contentType = "image/png",
  body: Uint8Array = PNG,
): Response {
  // `.buffer` because lib.dom's `BodyInit` does not admit a generic
  // `Uint8Array<ArrayBufferLike>` under TS 5.6.
  return new Response(body.buffer as ArrayBuffer, {
    status: 200,
    headers: { "content-type": contentType },
  });
}

function ctx(id: string, key: string) {
  return { params: Promise.resolve({ id, key: encodeURIComponent(key) }) };
}

function req(): Request {
  return new Request("http://localhost/api/jobs/x/places/y/photo");
}

async function seedPlace(
  userId: string,
  photoUrl: string | undefined,
): Promise<{ jobId: string; key: string }> {
  const job = await createJob(handle.db, {
    userId,
    location: { query: "Rosemont, Montreal" },
    requestText: "italian",
    requirements: [],
    intentIds: [],
    searchLang: "fr",
    uiLocale: "en",
    timeoutSec: 480,
  });
  const key = "panella|515 rue saint-zotique est";
  await upsertPlace(handle.db, job.id, {
    name: "Panella",
    canonicalKey: key,
    thumbnailUrl: photoUrl,
  });
  return { jobId: job.id, key };
}

beforeEach(async () => {
  handle = await makeTestDb();
  requested = [];
  upstream = vi.fn((url: string, init?: RequestInit) => {
    requested.push({ url, redirect: init?.redirect });
    return Promise.resolve(imageResponse());
  });
  __setWebDeps({
    db: handle.db,
    env: testEnv(),
    fetch: upstream as unknown as typeof fetch,
  });
  logSpies = (["info", "warn", "error"] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(() => {}),
  );
});

afterEach(() => {
  __setWebDeps(undefined);
  for (const spy of logSpies) spy.mockRestore();
  handle.client.close();
});

describe("GET /api/jobs/:id/places/:key/photo", () => {
  it("serves the bytes from our own origin, with the guards that makes necessary", async () => {
    const user = await getOrCreateLocalUser(handle.db);
    const { jobId, key } = await seedPlace(user.id, "https://panella.ca/og.png");

    const res = await GET(req(), ctx(jobId, key));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    // Third-party bytes served from OUR origin: a browser that sniffed them
    // as HTML would sniff them into our security context.
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
    expect(requested).toEqual([
      // A followed redirect walks the request off the host the gate approved.
      { url: "https://panella.ca/og.png", redirect: "error" },
    ]);
  });

  it("fetches nothing for a job that belongs to someone else", async () => {
    const other = randomUUID();
    await handle.db.insert(schema.users).values({
      id: other,
      email: `${other}@example.test`,
      uiLocale: "en",
      defaultTimeoutSec: 480,
      createdAt: Date.now(),
    });
    const { jobId, key } = await seedPlace(other, "https://panella.ca/og.png");

    const res = await GET(req(), ctx(jobId, key));

    expect(res.status).toBe(404);
    // The ownership check runs BEFORE the outbound request, so this route is
    // not a way to make our server fetch a URL on a stranger's behalf.
    expect(upstream).not.toHaveBeenCalled();
  });

  it("404s for a place that is not in this job", async () => {
    const user = await getOrCreateLocalUser(handle.db);
    const { jobId } = await seedPlace(user.id, "https://panella.ca/og.png");

    const res = await GET(req(), ctx(jobId, "somewhere|else"));

    expect(res.status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("404s when the place recorded no photo", async () => {
    const user = await getOrCreateLocalUser(handle.db);
    const { jobId, key } = await seedPlace(user.id, undefined);

    expect((await GET(req(), ctx(jobId, key))).status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("refuses a stored URL that points inside an infrastructure network", async () => {
    // Rows written before the capture-side gate existed, and anything that
    // reached the column by another route. The check runs again here because
    // a stored value is not evidence that a check once passed.
    const user = await getOrCreateLocalUser(handle.db);
    for (const url of [
      "https://169.254.169.254/latest/meta-data/",
      "https://localhost/p.png",
      "https://localhost./p.png",
      "https://[::ffff:127.0.0.1]:8787/p.png",
      "http://panella.ca/og.png",
      "javascript:alert(1)",
    ]) {
      const { jobId, key } = await seedPlace(user.id, url);
      expect((await GET(req(), ctx(jobId, key))).status).toBe(404);
    }
    expect(upstream).not.toHaveBeenCalled();
  });

  it("refuses to pass through an SVG, whatever the upstream calls it", async () => {
    // An SVG is a document that can carry script, and serving one from our
    // own origin is stored XSS with extra steps.
    const user = await getOrCreateLocalUser(handle.db);
    const { jobId, key } = await seedPlace(user.id, "https://panella.ca/og.svg");
    upstream.mockResolvedValueOnce(
      imageResponse("image/svg+xml", new TextEncoder().encode("<svg onload=x>")),
    );

    expect((await GET(req(), ctx(jobId, key))).status).toBe(404);
  });

  it("refuses an upstream that answers with HTML", async () => {
    const user = await getOrCreateLocalUser(handle.db);
    const { jobId, key } = await seedPlace(user.id, "https://panella.ca/og.png");
    upstream.mockResolvedValueOnce(
      imageResponse("text/html", new TextEncoder().encode("<script>x</script>")),
    );

    expect((await GET(req(), ctx(jobId, key))).status).toBe(404);
  });

  it("404s rather than throwing when the host is unreachable", async () => {
    const user = await getOrCreateLocalUser(handle.db);
    const { jobId, key } = await seedPlace(user.id, "https://panella.ca/og.png");
    upstream.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    expect((await GET(req(), ctx(jobId, key))).status).toBe(404);
  });

  it("refuses a body larger than a thumbnail could be", async () => {
    // Capped on the bytes actually read: `content-length` is a claim by a
    // host we do not trust.
    const user = await getOrCreateLocalUser(handle.db);
    const { jobId, key } = await seedPlace(user.id, "https://panella.ca/og.png");
    upstream.mockResolvedValueOnce(
      imageResponse("image/png", new Uint8Array(6 * 1024 * 1024)),
    );

    expect((await GET(req(), ctx(jobId, key))).status).toBe(404);
  });

  it("stops reading at the cap instead of buffering whatever the host sends", async () => {
    // A body that never ends. Buffering it whole before checking its size
    // would never return; reading it capped stops a little past 5 MB.
    const user = await getOrCreateLocalUser(handle.db);
    const { jobId, key } = await seedPlace(user.id, "https://panella.ca/og.png");
    let pulled = 0;
    let cancelled = false;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
      cancel() {
        cancelled = true;
      },
    });
    upstream.mockResolvedValueOnce(
      new Response(endless, { status: 200, headers: { "content-type": "image/png" } }),
    );

    expect((await GET(req(), ctx(jobId, key))).status).toBe(404);
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThan(10);
  });
});

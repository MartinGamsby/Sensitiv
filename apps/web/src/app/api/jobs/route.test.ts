import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createJob,
  getJobById,
  getOrCreateLocalUser,
  schema,
  type Database,
} from "@sensitiv/db";
import { __setWebDeps } from "../../../server/deps.ts";
import { makeTestDb } from "../../../test-support/db.ts";
import { testEnv } from "../../../test-support/env.ts";
import { GET, POST } from "./route.ts";

let handle: Database;
let workerBodies: string[];
let workerFetch: ReturnType<typeof vi.fn>;
let logSpies: Array<ReturnType<typeof vi.spyOn>>;
let logged: string[];

function validBody(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    location: { query: "Plateau-Mont-Royal, Montreal" },
    requestText: "gluten free brunch",
    chipIds: ["celiac"],
    uiLocale: "en",
    timeoutSec: 480,
    ...extra,
  };
}

function postReq(body: unknown): Request {
  return new Request("http://localhost/api/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  handle = await makeTestDb();
  workerBodies = [];
  workerFetch = vi.fn(
    async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      if (typeof init?.body === "string") workerBodies.push(init.body);
      return new Response(JSON.stringify({ accepted: true }), { status: 202 });
    },
  );
  __setWebDeps({
    db: handle.db,
    env: testEnv(),
    fetch: workerFetch as unknown as typeof fetch,
  });

  logged = [];
  logSpies = (["info", "warn", "error"] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    }),
  );
});

afterEach(() => {
  __setWebDeps(undefined);
  for (const spy of logSpies) spy.mockRestore();
  handle.client.close();
});

describe("POST /api/jobs", () => {
  it("creates a queued job owned by the local user and returns 201 { jobId }", async () => {
    const res = await POST(postReq(validBody()));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(typeof body.jobId).toBe("string");

    const user = await getOrCreateLocalUser(handle.db);
    const job = await getJobById(handle.db, body.jobId);
    expect(job?.userId).toBe(user.id);
    expect(job?.status).toBe("queued");
    expect(job?.requirements.some((r) => r.id === "celiac")).toBe(true);

    // Worker was pinged with the job id.
    expect(workerFetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(workerBodies[0]!)).toMatchObject({ jobId: body.jobId });
  });

  it("derives requirements from the catalog without an LLM round-trip", async () => {
    // Planning is the worker's job: it owns the budget + abort signal, and it
    // re-plans from `requestText` anyway. A route handler that awaited an LLM
    // call would block the submit on an unbounded network request.
    const env = testEnv({ ANTHROPIC_API_KEY: "sk-ant-should-never-be-used" });
    __setWebDeps({
      db: handle.db,
      env,
      fetch: workerFetch as unknown as typeof fetch,
    });

    const res = await POST(
      postReq(validBody({ chipIds: ["celiac", "bogus_chip"] })),
    );
    expect(res.status).toBe(201);

    // Only the worker enqueue was called — nothing reached an LLM endpoint.
    expect(workerFetch).toHaveBeenCalledTimes(1);
    const calledUrl = String(workerFetch.mock.calls[0]![0]);
    expect(calledUrl).toContain("/jobs");
    expect(calledUrl).not.toContain("anthropic");

    const { jobId } = await res.json();
    const job = await getJobById(handle.db, jobId);
    // The unknown chip failed closed; the catalog chip survived, in catalog order.
    expect(job?.requirements.map((r) => r.id)).toEqual(["celiac"]);
    expect(job?.intentIds).toEqual(["dining", "grocery"]);
  });

  it("strips an unknown extra key", async () => {
    const res = await POST(postReq(validBody({ bogusKey: "haxx", evil: 1 })));
    expect(res.status).toBe(201);
    const { jobId } = await res.json();
    const job = await getJobById(handle.db, jobId);
    expect(JSON.stringify(job)).not.toContain("haxx");
  });

  it("clamps an out-of-range timeoutSec to the minimum (60)", async () => {
    const res = await POST(postReq(validBody({ timeoutSec: 5 })));
    expect(res.status).toBe(201);
    const { jobId } = await res.json();
    const job = await getJobById(handle.db, jobId);
    expect(job?.timeoutSec).toBe(60);
  });

  it("does not record the session unless the body asks for it", async () => {
    // The privacy default. An old client (or a hand-rolled POST) that omits
    // the field must get a job with recording OFF, not the original always-on
    // behaviour: a Solari recording captures search URLs that spell out this
    // user's health / accessibility / housing requirements.
    const off = await POST(postReq(validBody()));
    const offJob = await getJobById(handle.db, (await off.json()).jobId);
    expect(offJob?.recordSession).toBe(false);

    const on = await POST(postReq(validBody({ recordSession: true })));
    const onJob = await getJobById(handle.db, (await on.json()).jobId);
    expect(onJob?.recordSession).toBe(true);
  });

  it("still returns 201 (queued) when the worker enqueue call fails", async () => {
    workerFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const res = await POST(postReq(validBody()));
    expect(res.status).toBe(201);
    const { jobId } = await res.json();
    const job = await getJobById(handle.db, jobId);
    expect(job?.status).toBe("queued");
  });

  it("never persists or logs the BYOK Solari key, but does forward it to the worker", async () => {
    const KEY = "sk-LEAKME-do-not-store";
    const res = await POST(postReq(validBody({ solariKey: KEY })));
    expect(res.status).toBe(201);
    const created = await res.json();
    const jobId: string = created.jobId;

    // Not in the response of the create call or the list.
    expect(JSON.stringify(created)).not.toContain(KEY);
    const listBody = await (await GET()).json();
    expect(JSON.stringify(listBody)).not.toContain(KEY);

    // Not in any column of the created job row.
    const job = await getJobById(handle.db, jobId);
    expect(JSON.stringify(job)).not.toContain(KEY);

    // Not in any log line.
    expect(logged.join("\n")).not.toContain(KEY);

    // But it DID reach the worker, in the request body only.
    expect(workerBodies).toHaveLength(1);
    expect(JSON.parse(workerBodies[0]!)).toEqual({ jobId, solariKey: KEY });
  });
});

describe("GET /api/jobs", () => {
  it("lists the user's jobs newest-first with trimmed fields", async () => {
    await POST(postReq(validBody({ requestText: "first" })));
    await POST(postReq(validBody({ requestText: "second" })));

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.jobs).toHaveLength(2);
    expect(body.jobs[0].requestText).toBe("second");
    expect(Object.keys(body.jobs[0]).sort()).toEqual(
      [
        "createdAt",
        "finishedAt",
        "id",
        "location",
        "placeCount",
        "requestText",
        "sourceModes",
        "status",
      ].sort(),
    );
    expect(body.jobs[0].location).toEqual({ query: "Plateau-Mont-Royal, Montreal" });
  });

  it("includes createdAt, sourceModes, placeCount and topPlace, and never another user's jobs", async () => {
    await POST(postReq(validBody({ requestText: "mine" })));

    const res = await GET();
    const body = await res.json();
    expect(body.jobs).toHaveLength(1);
    const row = body.jobs[0];
    expect(typeof row.createdAt).toBe("number");
    // A freshly-created (still queued) job has no recorded modes yet.
    expect(row.sourceModes).toEqual({});
    expect(row.placeCount).toBe(0);
    expect(row.topPlace).toBeUndefined();

    // Ownership boundary: a job owned by a different user never surfaces here.
    // `jobs.user_id` is a foreign key, so this needs a real user row first.
    const otherUserId = randomUUID();
    await handle.db.insert(schema.users).values({
      id: otherUserId,
      email: `${otherUserId}@example.test`,
      uiLocale: "en",
      defaultTimeoutSec: 480,
      createdAt: Date.now(),
    });
    const otherJob = await createJob(handle.db, {
      userId: otherUserId,
      location: { query: "Elsewhere" },
      requestText: "not mine",
      requirements: [],
      intentIds: [],
      searchLang: "en",
      uiLocale: "en",
      timeoutSec: 480,
    });
    const res2 = await GET();
    const body2 = await res2.json();
    expect(JSON.stringify(body2)).not.toContain(otherJob.id);
    expect(JSON.stringify(body2)).not.toContain("not mine");
  });
});

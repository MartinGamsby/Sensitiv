import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { GET, __resetGeocodeRateLimit } from "./route.ts";

const NOMINATIM_JSON = {
  place_id: 123,
  licence: "Data © OpenStreetMap contributors",
  display_name: "Plateau-Mont-Royal, Montreal, Quebec, H2T, Canada",
  boundingbox: ["45.5", "45.6", "-73.6", "-73.5"],
  address: {
    city: "Montreal",
    state: "Quebec",
    country: "Canada",
    country_code: "ca",
    postcode: "H2T 1A1",
  },
};

type FetchFn = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/** A typed `fetch` stub whose `.mock.calls` are inspectable. */
function stubFetch(impl: FetchFn): Mock<FetchFn> {
  const spy = vi.fn<FetchFn>(impl);
  vi.stubGlobal("fetch", spy);
  return spy;
}

const ok = (payload: unknown): Promise<Response> =>
  Promise.resolve(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );

function req(query: string): Request {
  return new Request(`http://localhost/api/geocode${query}`);
}

beforeEach(() => {
  __resetGeocodeRateLimit();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /api/geocode — coordinate validation", () => {
  it("rejects a non-numeric lat", async () => {
    expect((await GET(req("?lat=abc&lng=-73"))).status).toBe(400);
  });

  it("rejects a lat outside [-90, 90]", async () => {
    expect((await GET(req("?lat=95&lng=0"))).status).toBe(400);
  });

  it("rejects a lng outside [-180, 180]", async () => {
    expect((await GET(req("?lat=45&lng=999"))).status).toBe(400);
  });

  it("rejects a missing lat/lng even when a rogue ?url= is supplied", async () => {
    const spy = stubFetch(() => ok(NOMINATIM_JSON));
    const res = await GET(
      req("?url=http://169.254.169.254/latest/meta-data/&host=evil.example"),
    );
    expect(res.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("GET /api/geocode — SSRF hardening", () => {
  it("only ever fetches the hardcoded Nominatim origin, ignoring ?url=", async () => {
    const spy = stubFetch(() => ok(NOMINATIM_JSON));

    const res = await GET(
      req(
        "?lat=45.51&lng=-73.58&url=http://169.254.169.254/latest/meta-data/&format=xml",
      ),
    );
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);

    const calledUrl = new URL(spy.mock.calls[0]![0] as string | URL);
    expect(calledUrl.origin).toBe("https://nominatim.openstreetmap.org");
    expect(calledUrl.pathname).toBe("/reverse");
    expect(calledUrl.searchParams.get("url")).toBeNull();
    expect(calledUrl.searchParams.get("lat")).toBe("45.51");
    expect(calledUrl.searchParams.get("lon")).toBe("-73.58");
  });

  it("sends a descriptive User-Agent per Nominatim policy", async () => {
    const spy = stubFetch(() => ok(NOMINATIM_JSON));
    await GET(req("?lat=45.51&lng=-73.58"));
    const init = spy.mock.calls[0]![1]!;
    const headers = init.headers as Record<string, string>;
    expect(headers["user-agent"]).toMatch(/sensitiv/i);
    expect(headers["accept-language"]).toBe("en");
  });

  it("returns only the mapped Location fields, never the raw upstream body", async () => {
    stubFetch(() => ok(NOMINATIM_JSON));

    const res = await GET(req("?lat=45.51&lng=-73.58"));
    const body = await res.json();

    expect(body.location).toEqual({
      query: "Montreal, Quebec, Canada",
      city: "Montreal",
      region: "Quebec",
      country: "CA",
      countryName: "Canada",
      postalCode: "H2T 1A1",
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("licence");
    expect(serialized).not.toContain("boundingbox");
    expect(serialized).not.toContain("place_id");
  });

  it("maps a non-2xx upstream to a generic 502", async () => {
    stubFetch(() =>
      Promise.resolve(new Response("upstream detail", { status: 500 })),
    );
    const res = await GET(req("?lat=45.51&lng=-73.58"));
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("upstream detail");
  });

  it("rate-limits a second call within the interval", async () => {
    stubFetch(() => ok(NOMINATIM_JSON));
    expect((await GET(req("?lat=45.51&lng=-73.58"))).status).toBe(200);
    expect((await GET(req("?lat=10&lng=10"))).status).toBe(429);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { GET } from "./route.ts";
import { __resetGeocodeRateLimit } from "./rate-limit.ts";

const NOMINATIM_JSON = {
  place_id: 123,
  licence: "Data © OpenStreetMap contributors",
  display_name: "Plateau-Mont-Royal, Montreal, Quebec, H2T, Canada",
  boundingbox: ["45.5", "45.6", "-73.6", "-73.5"],
  address: {
    // Present because the route asks Nominatim for `zoom=14`, which is what
    // makes a neighbourhood name available at all.
    suburb: "Le Plateau-Mont-Royal",
    city: "Montreal",
    state: "Quebec",
    country: "Canada",
    country_code: "ca",
    postcode: "H2T 1A1",
  },
};

/** The same fix, in a place Nominatim can name no city for. */
const NOMINATIM_NO_CITY = {
  place_id: 456,
  display_name: "Quebec, Canada",
  address: { state: "Quebec", country: "Canada", country_code: "ca" },
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
      // Neighbourhood first: it is both what the user recognises and a far
      // better search anchor than the city centroid.
      query: "Le Plateau-Mont-Royal, Montreal, Quebec",
      city: "Montreal",
      region: "Quebec",
      country: "CA",
      countryName: "Canada",
      postalCode: "H2T 1A1",
      // Echoed back from the REQUEST, not read out of the upstream body. The
      // caller already has them; returning them is what lets a search anchor on
      // a map point rather than on a place name.
      lat: 45.51,
      lng: -73.58,
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("licence");
    expect(serialized).not.toContain("boundingbox");
    expect(serialized).not.toContain("place_id");
  });

  it("asks Nominatim for a neighbourhood-level answer, not a city-level one", async () => {
    // `zoom=10` tops out at the city, which is how a fix in the Plateau came
    // back as "Montreal" and a fix outside any city came back with no city at
    // all.
    const spy = stubFetch(() => ok(NOMINATIM_JSON));
    await GET(req("?lat=45.51&lng=-73.58"));
    const calledUrl = new URL(spy.mock.calls[0]![0] as string | URL);
    expect(calledUrl.searchParams.get("zoom")).toBe("14");
  });

  it("refuses to answer with a PROVINCE when it cannot name a city", async () => {
    // Without this the label fell back to `[region, countryName]` and offered
    // the user "Quebec, Canada" as their location — a province whose centroid
    // is several hundred km of boreal forest. That is the same misinformation
    // the location field's coarse-fix guard exists to prevent, arriving by a
    // different route. The caller renders "could not look up that location"
    // and leaves the field as the user had it.
    stubFetch(() => ok(NOMINATIM_NO_CITY));
    const res = await GET(req("?lat=52.476&lng=-71.826"));
    expect(res.status).toBe(200);
    expect((await res.json()).location).toBeNull();
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

const NOMINATIM_SEARCH_JSON = [
  {
    place_id: 456,
    licence: "Data © OpenStreetMap contributors",
    lat: "45.5031824",
    lon: "-73.5698065",
    display_name: "Montreal, Urban agglomeration of Montreal, Quebec, Canada",
    boundingbox: ["45.4", "45.7", "-73.9", "-73.4"],
    address: {
      city: "Montreal",
      state: "Quebec",
      country: "Canada",
      country_code: "ca",
    },
  },
];

describe("GET /api/geocode — forward mode", () => {
  it("resolves free text to coordinates plus the structured fields", async () => {
    stubFetch(() => ok(NOMINATIM_SEARCH_JSON));

    const res = await GET(req("?q=Montreal%2C%20Quebec%2C%20Canada"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.location).toEqual({
      // The user's own text stays authoritative for display; only the
      // structured fields and coordinates come from upstream.
      query: "Montreal, Quebec, Canada",
      city: "Montreal",
      region: "Quebec",
      country: "CA",
      countryName: "Canada",
      postalCode: null,
      lat: 45.50318,
      lng: -73.56981,
    });
  });

  it("only ever fetches the hardcoded /search origin, ignoring ?url=", async () => {
    const spy = stubFetch(() => ok(NOMINATIM_SEARCH_JSON));

    await GET(req("?q=Montreal&url=http://169.254.169.254/latest/meta-data/"));

    const calledUrl = new URL(spy.mock.calls[0]![0] as string | URL);
    expect(calledUrl.origin).toBe("https://nominatim.openstreetmap.org");
    expect(calledUrl.pathname).toBe("/search");
    expect(calledUrl.searchParams.get("url")).toBeNull();
    expect(calledUrl.searchParams.get("q")).toBe("Montreal");
  });

  it("forwards a 2-letter country hint and drops anything else", async () => {
    const spy = stubFetch(() => ok(NOMINATIM_SEARCH_JSON));
    await GET(req("?q=Montreal&country=CA"));
    expect(
      new URL(spy.mock.calls[0]![0] as string | URL).searchParams.get("countrycodes"),
    ).toBe("ca");

    __resetGeocodeRateLimit();
    const spy2 = stubFetch(() => ok(NOMINATIM_SEARCH_JSON));
    await GET(req("?q=Montreal&country=..%2F..%2Fadmin"));
    expect(
      new URL(spy2.mock.calls[0]![0] as string | URL).searchParams.get("countrycodes"),
    ).toBeNull();
  });

  it("a miss is `location: null` and a 200, not an error", async () => {
    // OpenStreetMap has no Canadian postal-code data, so this is exactly what a
    // Montreal FSA does here. The caller must degrade, not fail.
    stubFetch(() => ok([]));
    const res = await GET(req("?q=H1S"));
    expect(res.status).toBe(200);
    expect((await res.json()).location).toBeNull();
  });

  it("never leaks the raw upstream body", async () => {
    stubFetch(() => ok(NOMINATIM_SEARCH_JSON));
    const serialized = JSON.stringify(await (await GET(req("?q=Montreal"))).json());
    expect(serialized).not.toContain("licence");
    expect(serialized).not.toContain("boundingbox");
    expect(serialized).not.toContain("place_id");
    expect(serialized).not.toContain("display_name");
  });

  it("rejects an empty or over-long q", async () => {
    expect((await GET(req("?q=%20%20"))).status).toBe(400);
    __resetGeocodeRateLimit();
    expect((await GET(req(`?q=${"a".repeat(201)}`))).status).toBe(400);
  });

  it("shares one rate-limit window with reverse mode", async () => {
    // Nominatim's policy is one request per second per CLIENT, not per endpoint.
    stubFetch(() => ok(NOMINATIM_SEARCH_JSON));
    expect((await GET(req("?q=Montreal"))).status).toBe(200);
    expect((await GET(req("?lat=45.51&lng=-73.58"))).status).toBe(429);
  });

  it("maps an upstream failure to a generic 502", async () => {
    stubFetch(() => Promise.resolve(new Response("boom", { status: 500 })));
    const res = await GET(req("?q=Montreal"));
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("boom");
  });
});

describe("GET /api/geocode — coarse matches", () => {
  it("withholds coordinates for a province-sized match but keeps the fields", async () => {
    // Nominatim answers "Quebec, Canada" with the PROVINCE, centroid (52.476,
    // -71.826) — boreal forest, hundreds of km from anywhere. Pinning a 5 km
    // restaurant search there is worse than no coordinates, because having them
    // suppresses the worker's own Google Maps resolve hop.
    stubFetch(() =>
      ok([
        {
          lat: "52.4760" + "9",
          lon: "-71.82587",
          boundingbox: ["44.99", "62.59", "-79.76", "-57.10"],
          address: { state: "Quebec", country: "Canada", country_code: "ca" },
        },
      ]),
    );

    const body = await (await GET(req("?q=Quebec%2C%20Canada"))).json();

    expect(body.location.lat).toBeNull();
    expect(body.location.lng).toBeNull();
    expect(body.location.region).toBe("Quebec");
    expect(body.location.country).toBe("CA");
  });

  it("keeps coordinates for a city-sized match", async () => {
    // The island of Montreal spans ~0.3 degrees — every real city clears the bar.
    stubFetch(() =>
      ok([
        {
          lat: "45.5031824",
          lon: "-73.5698065",
          boundingbox: ["45.41", "45.70", "-73.97", "-73.47"],
          address: { city: "Montreal", state: "Quebec", country: "Canada", country_code: "ca" },
        },
      ]),
    );

    const body = await (await GET(req("?q=Montreal"))).json();

    expect(body.location.lat).toBe(45.50318);
    expect(body.location.city).toBe("Montreal");
  });

  it("keeps coordinates when upstream sends no bounding box at all", async () => {
    stubFetch(() => ok([{ lat: "45.5", lon: "-73.5", address: { country_code: "ca" } }]));
    expect((await (await GET(req("?q=x"))).json()).location.lat).toBe(45.5);
  });
});

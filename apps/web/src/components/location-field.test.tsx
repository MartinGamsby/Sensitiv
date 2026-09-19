import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { LocationField, type LocationDraft } from "./location-field.tsx";
import { renderIntl } from "../test-support/intl.tsx";

function Harness({ fetchImpl }: { fetchImpl?: typeof fetch }) {
  const [value, setValue] = useState<LocationDraft>({
    query: "",
    postalCode: "",
  });
  return (
    <>
      <output data-testid="query">{value.query}</output>
      <output data-testid="country">{value.country ?? ""}</output>
      <output data-testid="lat">{value.lat ?? ""}</output>
      <output data-testid="radius">{value.radiusKm ?? ""}</output>
      <output data-testid="pinned">{value.pinned ? "yes" : "no"}</output>
      <LocationField value={value} onChange={setValue} fetchImpl={fetchImpl} />
    </>
  );
}

afterEach(() => {
  // @ts-expect-error test cleanup
  delete navigator.geolocation;
});

describe("<LocationField />", () => {
  it("'Use my location' geolocates on click, then calls /api/geocode and fills fields", async () => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (ok: PositionCallback) =>
          ok({
            coords: { latitude: 45.52, longitude: -73.58 },
          } as GeolocationPosition),
      },
    });

    const calledUrls: string[] = [];
    const geocodeFetch = vi.fn(
      async (input: RequestInfo | URL) => {
        calledUrls.push(String(input));
        return new Response(
          JSON.stringify({
            location: {
              query: "Montréal, Quebec, Canada",
              city: "Montréal",
              region: "Quebec",
              country: "CA",
              countryName: "Canada",
              postalCode: "H2T 1S5",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    ) as unknown as typeof fetch;

    renderIntl(<Harness fetchImpl={geocodeFetch} />);

    fireEvent.click(screen.getByRole("button", { name: "Use my location" }));

    await waitFor(() => {
      expect(screen.getByTestId("country").textContent).toBe("CA");
    });
    expect(screen.getByTestId("query").textContent).toBe(
      "Montréal, Quebec, Canada",
    );
    expect(calledUrls[0] ?? "").toContain("/api/geocode?lat=45.52&lng=-73.58");
  });

  it("shows an inline message when permission is denied (no crash)", async () => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (_ok: PositionCallback, err: PositionErrorCallback) =>
          err({
            code: 1,
            PERMISSION_DENIED: 1,
          } as GeolocationPositionError),
      },
    });

    renderIntl(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Use my location" }));

    expect(
      await screen.findByText(
        "Location permission was denied. Type a location instead.",
      ),
    ).toBeTruthy();
  });
});

describe("<LocationField /> — how much the browser's fix can be trusted", () => {
  function stubPosition(coords: Partial<GeolocationCoordinates>, opts: {
    captureOptions?: (o?: PositionOptions) => void;
  } = {}) {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (
          ok: PositionCallback,
          _err?: PositionErrorCallback,
          options?: PositionOptions,
        ) => {
          opts.captureOptions?.(options);
          ok({ coords } as GeolocationPosition);
        },
      },
    });
  }

  it("refuses a fix the browser itself says is hundreds of km wide", async () => {
    // This is how the location field came to read "Quebec, Canada": a desktop
    // with no GPS falls back to IP geolocation, the fix lands in unpopulated
    // Nord-du-Quebec, Nominatim correctly reports no city there, and the app
    // built a province-wide "location" out of it.
    stubPosition({ latitude: 52.476, longitude: -71.826, accuracy: 250_000 });
    const geocodeFetch = vi.fn();

    renderIntl(<Harness fetchImpl={geocodeFetch as unknown as typeof fetch} />);
    fireEvent.click(screen.getByRole("button", { name: /use my location/i }));

    await waitFor(() => {
      expect(screen.getByText(/only place you very roughly/i)).toBeTruthy();
    });
    // No reverse geocode is even attempted, and the field is left alone: a name
    // derived from a fix that vague is misinformation, not a default.
    expect(geocodeFetch).not.toHaveBeenCalled();
    expect(screen.getByTestId("query").textContent).toBe("");
  });

  it("accepts a street-level fix and keeps its coordinates", async () => {
    stubPosition({ latitude: 45.52, longitude: -73.58, accuracy: 40 });
    const geocodeFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          location: {
            query: "Montréal, Quebec, Canada",
            city: "Montréal",
            region: "Quebec",
            country: "CA",
            countryName: "Canada",
            postalCode: null,
            lat: 45.52,
            lng: -73.58,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    renderIntl(<Harness fetchImpl={geocodeFetch as unknown as typeof fetch} />);
    fireEvent.click(screen.getByRole("button", { name: /use my location/i }));

    await waitFor(() => {
      expect(screen.getByTestId("query").textContent).toBe("Montréal, Quebec, Canada");
    });
    expect(geocodeFetch).toHaveBeenCalled();
  });

  it("asks for a high-accuracy fix, which is what consults WiFi over IP", async () => {
    let seen: PositionOptions | undefined;
    stubPosition(
      { latitude: 45.52, longitude: -73.58, accuracy: 40 },
      { captureOptions: (o) => (seen = o) },
    );

    renderIntl(<Harness fetchImpl={vi.fn() as unknown as typeof fetch} />);
    fireEvent.click(screen.getByRole("button", { name: /use my location/i }));

    await waitFor(() => expect(seen).toBeDefined());
    expect(seen?.enableHighAccuracy).toBe(true);
  });

  it("typing in either box clears coordinates that described the old text", async () => {
    stubPosition({ latitude: 45.52, longitude: -73.58, accuracy: 40 });
    const geocodeFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          location: { query: "Montréal", city: "Montréal", lat: 45.52, lng: -73.58 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    renderIntl(<Harness fetchImpl={geocodeFetch as unknown as typeof fetch} />);
    fireEvent.click(screen.getByRole("button", { name: /use my location/i }));
    await waitFor(() => {
      expect(screen.getByTestId("query").textContent).toBe("Montréal");
    });

    fireEvent.change(screen.getByLabelText(/location/i), {
      target: { value: "Quebec City" },
    });

    // Coordinates describe the text they were resolved FROM; keeping them
    // across an edit pins the search to the previous place.
    expect(screen.getByTestId("lat").textContent).toBe("");
  });

  it("treats a null geocode answer as a miss and leaves the field alone", async () => {
    // The route answers `null` rather than naming the PROVINCE a point falls in
    // (see /api/geocode). Without this branch the old code read `body.location
    // ?? {}`, kept the user's text, and quietly reported success.
    stubPosition({ latitude: 52.476, longitude: -71.826, accuracy: 40 });
    const geocodeFetch = vi.fn(async () =>
      new Response(JSON.stringify({ location: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    renderIntl(<Harness fetchImpl={geocodeFetch as unknown as typeof fetch} />);
    fireEvent.change(screen.getByLabelText(/location search/i), {
      target: { value: "somewhere" },
    });
    fireEvent.click(screen.getByRole("button", { name: /use my location/i }));

    await waitFor(() => {
      expect(screen.getByText(/could not look up that location/i)).toBeTruthy();
    });
    expect(screen.getByTestId("query").textContent).toBe("somewhere");
    expect(screen.getByTestId("lat").textContent).toBe("");
  });

  /** The number box. `getByLabelText` is ambiguous now that the slider
   *  carries the same name — which is the point: they set one value. */
  function radiusBox(): HTMLInputElement {
    return screen.getByRole("spinbutton", { name: /search radius/i });
  }

  it("carries the search radius, defaulting to 3 km", () => {
    renderIntl(<Harness />);
    expect(radiusBox().value).toBe("3");
  });

  it("takes any radius, not one of four", () => {
    // It was a `<select>` over [1, 3, 5, 10], which is fine until the answer
    // is 2 — a walkable neighbourhood is not one of four sizes.
    renderIntl(<Harness />);

    fireEvent.change(radiusBox(), { target: { value: "2.5" } });

    expect(screen.getByTestId("radius").textContent).toBe("2.5");
  });

  it("lets the box be emptied mid-edit without committing a zero", () => {
    // A controlled numeric input that commits every keystroke cannot be
    // retyped: "10" only reaches "2" through "", which parses as 0 and the
    // schema rejects. So an unparseable box commits nothing and the last
    // good value stands.
    renderIntl(<Harness />);

    fireEvent.change(radiusBox(), { target: { value: "" } });

    expect(screen.getByTestId("radius").textContent).toBe("");
    expect(radiusBox().value).toBe("");
  });

  it("settles an out-of-range or empty box when the field is left", () => {
    renderIntl(<Harness />);

    fireEvent.change(radiusBox(), { target: { value: "9999" } });
    fireEvent.blur(radiusBox());
    expect(screen.getByTestId("radius").textContent).toBe("100");

    fireEvent.change(radiusBox(), { target: { value: "" } });
    fireEvent.blur(radiusBox());
    // Back to the last good value rather than to nothing.
    expect(radiusBox().value).toBe("100");
  });

  it("drives the same value from the slider, on a curve that favours short trips", () => {
    // Linear over 0.5-100 km would squeeze the useful 1-10 km range into the
    // first centimetre of travel; squaring gives it about the first third.
    renderIntl(<Harness />);
    const slider = screen.getByRole("slider", { name: /search radius/i });

    fireEvent.change(slider, { target: { value: "500" } });
    expect(screen.getByTestId("radius").textContent).toBe("100");

    fireEvent.change(slider, { target: { value: "0" } });
    expect(screen.getByTestId("radius").textContent).toBe("0.5");

    // A third of the way along is still a walkable distance, not 33 km.
    fireEvent.change(slider, { target: { value: "167" } });
    expect(Number(screen.getByTestId("radius").textContent)).toBeLessThan(15);
    expect(radiusBox().value).toBe(screen.getByTestId("radius").textContent);
  });

  it("typing a postal code clears a pin, because they are rival answers", async () => {
    // A pin and a postal code both say where to search, and the pin OUTRANKS
    // the postal code downstream. Keeping a stale pin while the user types a
    // postal code would leave the search anchored somewhere the form no longer
    // shows, with the more specific of the two winning silently.
    stubPosition({ latitude: 45.52, longitude: -73.58, accuracy: 40 });
    const geocodeFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          location: { query: "Montréal", city: "Montréal", lat: 45.52, lng: -73.58 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    renderIntl(<Harness fetchImpl={geocodeFetch as unknown as typeof fetch} />);
    fireEvent.click(screen.getByRole("button", { name: /use my location/i }));
    await waitFor(() => expect(screen.getByTestId("lat").textContent).not.toBe(""));

    fireEvent.click(screen.getByRole("button", { name: /postal/i }));
    fireEvent.change(screen.getByLabelText(/postal/i), { target: { value: "H2T" } });
    expect(screen.getByTestId("lat").textContent).toBe("");
    expect(screen.getByTestId("pinned").textContent).toBe("no");
  });
});

describe("<LocationField /> — the map and the postal code are rivals", () => {
  it("hides both behind triggers, with the map the prominent one", () => {
    renderIntl(<Harness />);

    // Neither panel is open, so neither input is on the page yet.
    expect(screen.queryByLabelText(/postal/i)).toBeNull();
    const mapTrigger = screen.getByRole("button", { name: /pick a spot/i });
    const postalTrigger = screen.getByRole("button", { name: /postal/i });
    expect(mapTrigger.getAttribute("aria-expanded")).toBe("false");
    expect(postalTrigger.getAttribute("aria-expanded")).toBe("false");
    // The map is the one input on this form with no inference in it, so it
    // gets a real button and the postal code gets a quiet link.
    expect(mapTrigger.className).toContain("border");
    expect(postalTrigger.className).toContain("text-xs");
  });

  it("opens one at a time — they are rival answers to the same question", () => {
    renderIntl(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: /postal/i }));
    expect(screen.getByLabelText(/postal/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /pick a spot/i }));

    // Opening the map closed the postal code. A pin outranks a postal code
    // downstream, so offering both at once invites filling in two things
    // where only one will count.
    expect(screen.queryByLabelText(/postal/i)).toBeNull();
    expect(
      screen.getByRole("button", { name: /pick a spot/i }).getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("closes the open one when its own trigger is pressed again", () => {
    renderIntl(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: /postal/i }));
    fireEvent.click(screen.getByRole("button", { name: /postal/i }));

    expect(screen.queryByLabelText(/postal/i)).toBeNull();
  });

  it("shows a set postal code on the trigger, so closing it hides nothing", () => {
    renderIntl(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /postal/i }));
    fireEvent.change(screen.getByLabelText(/postal/i), {
      target: { value: "H2T 1A1" },
    });

    fireEvent.click(screen.getByRole("button", { name: /postal/i }));

    // Collapsed, but the value is still stated — a panel that hides a filled
    // field is a form that lies about what it will submit.
    expect(
      screen.getByRole("button", { name: /postal/i }).textContent,
    ).toContain("H2T 1A1");
  });
});

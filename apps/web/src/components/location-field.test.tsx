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
});

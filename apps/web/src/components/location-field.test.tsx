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

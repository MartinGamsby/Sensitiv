import { describe, expect, it } from "vitest";
import { parseTagQuote, sourceLabel } from "./sources.ts";

describe("sourceLabel", () => {
  it("names the sources that exist the way they name themselves", () => {
    expect(sourceLabel("google_maps")).toBe("Google Maps");
    expect(sourceLabel("openstreetmap")).toBe("OpenStreetMap");
  });

  it("humanizes an id it does not know rather than dropping it", () => {
    expect(sourceLabel("some_future_source")).toBe("Some future source");
  });

  it("never returns an empty label", () => {
    expect(sourceLabel("")).toBe("");
    expect(sourceLabel("__")).toBe("__");
  });
});

describe("parseTagQuote", () => {
  it("recognises an OpenStreetMap tag and keeps key and value verbatim", () => {
    expect(parseTagQuote("diet:gluten_free=only")).toEqual({
      key: "diet:gluten_free",
      value: "only",
    });
    expect(parseTagQuote("wheelchair=designated")).toEqual({
      key: "wheelchair",
      value: "designated",
    });
  });

  it("leaves prose alone even when it contains an equals sign", () => {
    expect(parseTagQuote("gluten free = life")).toBeUndefined();
    expect(parseTagQuote("Our fryer is dedicated.")).toBeUndefined();
    expect(parseTagQuote("")).toBeUndefined();
  });

  it("does not treat a sentence that merely starts like a tag as one", () => {
    expect(parseTagQuote("diet:gluten_free=only, they told us")).toBeUndefined();
  });
});

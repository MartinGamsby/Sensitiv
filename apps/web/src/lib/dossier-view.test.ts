import { describe, expect, it } from "vitest";
import { dossierViewFrom, withDossierView } from "./dossier-view.ts";

describe("dossierViewFrom", () => {
  it("reads the map view", () => {
    expect(dossierViewFrom("map")).toBe("map");
  });

  it("treats anything else as the list, including a hand-edited URL", () => {
    expect(dossierViewFrom(null)).toBe("list");
    expect(dossierViewFrom("list")).toBe("list");
    expect(dossierViewFrom("globe")).toBe("list");
    expect(dossierViewFrom("")).toBe("list");
  });
});

describe("withDossierView", () => {
  it("never writes the default into the URL", () => {
    // A query parameter that only ever says "the default" is noise in a link
    // someone is about to paste somewhere.
    expect(withDossierView(new URLSearchParams("view=map"), "list")).toBe("");
    expect(withDossierView(new URLSearchParams(), "list")).toBe("");
  });

  it("keeps an open place when the view changes", () => {
    // The two are independent: a reader can legitimately be looking at one
    // place's detail from either layout, and switching must not drop it.
    expect(withDossierView(new URLSearchParams("place=cafe+1"), "map")).toBe(
      "?place=cafe+1&view=map",
    );
    expect(
      withDossierView(new URLSearchParams("place=cafe+1&view=map"), "list"),
    ).toBe("?place=cafe+1");
  });

  it("leaves unrelated parameters alone", () => {
    expect(withDossierView(new URLSearchParams("utm=x"), "map")).toBe(
      "?utm=x&view=map",
    );
  });
});

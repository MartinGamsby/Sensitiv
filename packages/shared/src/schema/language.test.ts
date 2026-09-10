import { describe, expect, it } from "vitest";
import { disclaimerFor, resolveSearchLanguage } from "./language.ts";

describe("resolveSearchLanguage", () => {
  const cases: Array<{
    name: string;
    region?: string;
    country?: string;
    userDefault?: string | null;
    expected: { code: string; source: "auto" | "user" };
  }> = [
    { name: "Quebec region -> fr/auto", region: "Québec", country: "CA", expected: { code: "fr", source: "auto" } },
    { name: "QC abbreviation -> fr/auto", region: "qc", country: "CA", expected: { code: "fr", source: "auto" } },
    { name: "Canada, no region -> en/auto", country: "CA", expected: { code: "en", source: "auto" } },
    { name: "France -> fr/auto", country: "FR", expected: { code: "fr", source: "auto" } },
    { name: "unknown country -> en/auto", country: "ZZ", expected: { code: "en", source: "auto" } },
    { name: "no hints -> en/auto", expected: { code: "en", source: "auto" } },
    { name: "userDefault wins over everything", region: "Québec", country: "CA", userDefault: "es", expected: { code: "es", source: "user" } },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(
        resolveSearchLanguage({ region: c.region, country: c.country }, c.userDefault),
      ).toEqual(c.expected);
    });
  }

  it("treats empty-string userDefault as absent", () => {
    expect(resolveSearchLanguage({ country: "FR" }, "")).toEqual({ code: "fr", source: "auto" });
  });
});

describe("disclaimerFor", () => {
  it("returns the mandatory string per locale", () => {
    expect(disclaimerFor("en")).toMatch(/not medical, legal, or housing advice/);
    expect(disclaimerFor("fr")).toMatch(/aide à la recherche/);
  });
});

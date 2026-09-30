import { describe, expect, it } from "vitest";
import { format, translator } from "./ui-copy.ts";

describe("the recreated UI's copy", () => {
  it("comes from the web app's own messages, in both locales", () => {
    expect(translator("en")("form.submit")).toBe("Start research");
    expect(translator("fr")("form.submit")).not.toBe("Start research");
  });

  it("fills variables and one-level plurals", () => {
    expect(translator("en")("dossier.score.match", { percent: 44 })).toBe("Match 44%");
    expect(format("{count, plural, one {# source} other {# sources}}", { count: 1 })).toBe("1 source");
    expect(format("{count, plural, one {# source} other {# sources}}", { count: 2 })).toBe("2 sources");
  });

  it("shows a missing key as the key, rather than failing the render", () => {
    expect(translator("en")("form.nothing.here")).toBe("form.nothing.here");
  });
});

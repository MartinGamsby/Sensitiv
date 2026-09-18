import { describe, expect, it } from "vitest";
import { createDefaultRegistry } from "./adapters/index.ts";
import { AdapterRegistry } from "./registry.ts";
import type { JobLogLevel } from "./logger.ts";

function recorder() {
  const lines: string[] = [];
  const log = async (level: JobLogLevel, message: string): Promise<void> => {
    lines.push(`${level} ${message}`);
  };
  return { lines, log };
}

describe("AdapterRegistry", () => {
  it("resolves known adapter ids in order", async () => {
    const { log } = recorder();
    const registry = createDefaultRegistry();
    const adapters = await registry.resolve(
      ["openstreetmap", "google_maps"],
      log,
    );
    expect(adapters.map((a) => a.id)).toEqual(["openstreetmap", "google_maps"]);
  });

  it("logs a warning and skips unknown ids (kijiji / craigslist / housing)", async () => {
    const { lines, log } = recorder();
    const registry = createDefaultRegistry();
    const adapters = await registry.resolve(
      ["google_maps", "kijiji", "craigslist"],
      log,
    );
    expect(adapters.map((a) => a.id)).toEqual(["google_maps"]);
    expect(lines.join("\n")).toMatch(/kijiji.*not registered/);
    expect(lines.join("\n")).toMatch(/craigslist.*not registered/);
  });

  it("an empty registry resolves nothing but does not throw", async () => {
    const { lines, log } = recorder();
    const adapters = await new AdapterRegistry().resolve(["google_maps"], log);
    expect(adapters).toEqual([]);
    expect(lines.join("\n")).toMatch(/google_maps.*not registered/);
  });
});

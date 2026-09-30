import { describe, expect, it } from "vitest";
import { gifSize } from "./gif-size.ts";

describe("gifSize", () => {
  it("keeps the asked width when it already gives even sides", () => {
    expect(gifSize(800, 1920, 1080)).toEqual({ width: 800, height: 450, scale: 800 / 1920 });
  });

  it("steps down to the nearest width whose height is even too", () => {
    // 810 → 455.6; 16:9 needs a multiple of 32 for an even height.
    const size = gifSize(810, 1920, 1080);
    expect(size.width).toBe(800);
    expect(size.height).toBe(450);
  });

  it("never upscales past the composition", () => {
    expect(gifSize(4000, 1920, 1080)).toEqual({ width: 1920, height: 1080, scale: 1 });
  });

  it("handles other aspect ratios", () => {
    const square = gifSize(641, 1080, 1080);
    expect(square).toEqual({ width: 640, height: 640, scale: 640 / 1080 });
  });
});

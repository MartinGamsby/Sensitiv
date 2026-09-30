import { describe, expect, it } from "vitest";
import { chunk, limiter, mapWithConcurrency, pacer, Pool, splitEvenly } from "./util.ts";

describe("mapWithConcurrency", () => {
  it("preserves input order regardless of completion order", async () => {
    const out = await mapWithConcurrency([30, 10, 20], 3, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });
    expect(out).toEqual([30, 10, 20]);
  });

  it("never exceeds the limit", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 12 }, (_, i) => i), 3, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
    });
    expect(peak).toBe(3);
  });

  it("keeps the pool busy instead of waiting on the slowest of a batch", async () => {
    // The reason this is a pool and not chunk().map(Promise.all): one slow item
    // must not idle the others, and the slowest extraction in a real run is
    // several times the median.
    const order: number[] = [];
    await mapWithConcurrency([50, 1, 1, 1], 2, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      order.push(i);
    });
    // The three fast items all finish before the one slow item.
    expect(order[order.length - 1]).toBe(0);
  });

  it("handles an empty list", async () => {
    expect(await mapWithConcurrency([], 3, async () => 1)).toEqual([]);
  });

  it("propagates a rejection", async () => {
    await expect(
      mapWithConcurrency([1, 2], 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
  });
});

describe("splitEvenly", () => {
  it("balances the chunks instead of leaving a short one at the end", () => {
    expect(splitEvenly([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 3).map((c) => c.length)).toEqual([
      4, 4, 4,
    ]);
    expect(splitEvenly([1, 2, 3, 4, 5], 2)).toEqual([[1, 2, 3], [4, 5]]);
  });

  it("never makes an empty chunk", () => {
    expect(splitEvenly([1, 2], 5)).toEqual([[1], [2]]);
    expect(splitEvenly([], 3)).toEqual([]);
  });
});

describe("chunk", () => {
  it("splits preserving order", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns nothing for an empty list", () => {
    expect(chunk([], 3)).toEqual([]);
  });

  it("never loops forever on a zero size", () => {
    expect(chunk([1, 2], 0)).toEqual([[1], [2]]);
  });
});

describe("Pool", () => {
  it("never lends one item to two callers at once, and serves waiters in order", async () => {
    const pool = new Pool(["tab-1", "tab-2"]);
    const busy = new Set<string>();
    let clash = false;
    const order: number[] = [];
    await Promise.all(
      [0, 1, 2, 3, 4].map((i) =>
        pool.use(async (tab) => {
          if (busy.has(tab)) clash = true;
          busy.add(tab);
          order.push(i);
          await new Promise((r) => setTimeout(r, 5));
          busy.delete(tab);
        }),
      ),
    );
    expect(clash).toBe(false);
    expect(order).toEqual([0, 1, 2, 3, 4]);
  });

  it("takes the item back when the borrower throws", async () => {
    const pool = new Pool(["only"]);
    await expect(pool.use(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    // Would hang forever if the throw had kept the only item.
    await expect(pool.use(async (item) => item)).resolves.toBe("only");
  });
});

describe("limiter", () => {
  it("runs at most n calls at once", async () => {
    const limit = limiter(3);
    let inFlight = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 10 }, () =>
        limit(async () => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await new Promise((r) => setTimeout(r, 5));
          inFlight -= 1;
        }),
      ),
    );
    expect(peak).toBe(3);
  });
});

describe("pacer", () => {
  it("spaces callers apart even when they all ask at once", async () => {
    const pace = pacer(40);
    const at: number[] = [];
    const start = Date.now();
    await Promise.all([0, 1, 2].map(() => pace().then(() => at.push(Date.now() - start))));
    at.sort((a, b) => a - b);
    // The first goes straight through; each later one waits its own gap.
    expect(at[0]).toBeLessThan(30);
    expect(at[1]! - at[0]!).toBeGreaterThanOrEqual(35);
    expect(at[2]! - at[1]!).toBeGreaterThanOrEqual(35);
  });

  it("does not wait at all when the gap has already passed", async () => {
    const pace = pacer(20);
    await pace();
    await new Promise((r) => setTimeout(r, 30));
    const start = Date.now();
    await pace();
    expect(Date.now() - start).toBeLessThan(15);
  });
});

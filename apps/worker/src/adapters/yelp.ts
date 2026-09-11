// TODO(v1.1): real Yelp adapter. Registers so a dining/grocery job that unions
// it degrades gracefully instead of crashing.
import type { Adapter } from "./types.ts";

export const yelpAdapter: Adapter = {
  id: "yelp",
  supports: () => true,
  needsBrowser: false,
  async run(ctx) {
    await ctx.log("info", "adapter yelp is a v1.1 stub");
    return { findings: [] };
  },
};

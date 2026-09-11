// TODO(v1.1): real brand store-locator adapter.
import type { Adapter } from "./types.ts";

export const storeLocatorAdapter: Adapter = {
  id: "store_locator",
  supports: () => true,
  needsBrowser: false,
  async run(ctx) {
    await ctx.log("info", "adapter store_locator is a v1.1 stub");
    return { findings: [] };
  },
};

// TODO(v1.1): real Find Me Gluten Free adapter.
import type { Adapter } from "./types.ts";

export const findMeGlutenFreeAdapter: Adapter = {
  id: "find_me_gluten_free",
  supports: () => true,
  needsBrowser: false,
  async run(ctx) {
    await ctx.log("info", "adapter find_me_gluten_free is a v1.1 stub");
    return { findings: [] };
  },
};

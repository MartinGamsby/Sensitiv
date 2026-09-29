// pnpm video:assets [scenario-id…] [--offline]
//
// Downloads and caches what the scenarios need (map tiles, photos, music,
// fonts) — see `lib/prepare.ts`. `pnpm video` and `pnpm video:studio` run this
// first, so calling it by hand is only for warming the cache.

import { prepareAssets } from "./lib/prepare.ts";
import { pickScenarios } from "./lib/pick.ts";

const args = process.argv.slice(2).filter((a) => a !== "--");
const selected = pickScenarios(args.filter((a) => !a.startsWith("--")), { all: true });
await prepareAssets(selected, { offline: args.includes("--offline") });
console.log("  done\n");

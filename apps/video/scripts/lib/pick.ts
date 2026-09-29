import { DEFAULT_SCENARIO, scenarios } from "../../scenarios/index.ts";
import type { Scenario } from "../../src/config/scenario.ts";

/**
 * The scenarios a command line names; `all` for every one; with no names, the
 * default scenario (or every scenario when `all` is set). Exits with the list
 * of known ids on an unknown one.
 */
export function pickScenarios(ids: readonly string[], options: { all?: boolean } = {}): Scenario[] {
  if (ids.includes("all") || (ids.length === 0 && options.all)) return [...scenarios];
  const wanted = ids.length === 0 ? [DEFAULT_SCENARIO] : ids;
  const picked: Scenario[] = [];
  for (const id of wanted) {
    const found = scenarios.find((s) => s.id === id);
    if (!found) {
      console.error(`\n  Unknown scenario "${id}". Known: ${scenarios.map((s) => s.id).join(", ")}\n`);
      process.exit(1);
    }
    picked.push(found);
  }
  return picked;
}

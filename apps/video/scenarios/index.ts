import type { Scenario } from "../src/config/scenario.ts";
import mexicanPlaceDesArts from "./mexican-place-des-arts.ts";

// Every scenario the Studio lists and `pnpm video` can render. To add one,
// copy a scenario file, give it a new `id`, and list it here.
export const scenarios: readonly Scenario[] = [mexicanPlaceDesArts];

export const DEFAULT_SCENARIO = mexicanPlaceDesArts.id;

export function findScenario(id: string): Scenario | undefined {
  return scenarios.find((s) => s.id === id);
}

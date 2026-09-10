// TEST SUPPORT. `loadEnv` takes a `NodeJS.ProcessEnv`; in this app Next augments
// that type with a required `NODE_ENV`, so a bare record needs a cast. This
// helper keeps that cast in one place.
import { loadEnv, type Env } from "@sensitiv/shared/env";

export function testEnv(overrides: Record<string, string> = {}): Env {
  return loadEnv(overrides as unknown as NodeJS.ProcessEnv);
}

// Adapter registry: a `Map<string, Adapter>` keyed by adapter id. An unknown id
// (the catalog lists `store_locator` / `kijiji` / `craigslist`, which are
// declared ahead of being built) is LOGGED and SKIPPED — a grocery or housing
// job degrades, never crashes.
//
// This is now the ONLY way an intent's adapter goes unrun. Registering a no-op
// so the id "resolves" was the alternative, and it bought nothing but a line
// in the dossier saying a source had run and contributed nothing.
import type { Adapter } from "./adapters/types.ts";
import type { JobLogLevel } from "./logger.ts";

type Log = (level: JobLogLevel, message: string) => Promise<void>;

export class AdapterRegistry {
  #adapters = new Map<string, Adapter>();

  register(adapter: Adapter): this {
    this.#adapters.set(adapter.id, adapter);
    return this;
  }

  get(id: string): Adapter | undefined {
    return this.#adapters.get(id);
  }

  has(id: string): boolean {
    return this.#adapters.has(id);
  }

  ids(): string[] {
    return [...this.#adapters.keys()];
  }

  /** Resolve ids to adapters, in the given order. Unknown ids are logged + skipped. */
  async resolve(ids: readonly string[], log: Log): Promise<Adapter[]> {
    const out: Adapter[] = [];
    for (const id of ids) {
      const adapter = this.#adapters.get(id);
      if (!adapter) {
        await log("warn", `adapter "${id}" is not registered — skipping`);
        continue;
      }
      out.push(adapter);
    }
    return out;
  }
}

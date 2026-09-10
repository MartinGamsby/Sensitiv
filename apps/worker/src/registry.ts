// Adapter registry: a `Map<string, Adapter>` keyed by adapter id. An unknown id
// (the catalog lists `kijiji` / `craigslist` / `yelp` that this build does not
// all implement) is LOGGED and SKIPPED — a housing job degrades, never crashes.
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

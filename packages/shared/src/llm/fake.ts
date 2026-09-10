import type { ZodType } from "zod";
import { LlmError } from "./types.ts";
import type { LlmProvider, StructuredArgs } from "./types.ts";

export type FakeHandler = (args: StructuredArgs<unknown>) => unknown;

export type FakeLlmProviderOptions = {
  /** Canned values, returned in order, one per `completeStructured` call. */
  responses?: unknown[];
  /** Or a function computing the value from the call args. Wins over `responses`. */
  handler?: FakeHandler;
};

/**
 * Deterministic, offline test double. Used by the factory (empty `.env`) and by
 * the planner/worker tests. It still runs the caller's zod schema over whatever
 * it is about to return, so tests exercise validation exactly like the real one.
 */
export class FakeLlmProvider implements LlmProvider {
  readonly name = "fake";
  /** Every call, in order, for assertions. */
  readonly calls: StructuredArgs<unknown>[] = [];

  #responses: unknown[];
  #handler: FakeHandler | undefined;

  constructor(opts: FakeLlmProviderOptions = {}) {
    this.#responses = [...(opts.responses ?? [])];
    this.#handler = opts.handler;
  }

  completeStructured<T>(args: StructuredArgs<T>): Promise<T> {
    this.calls.push(args as StructuredArgs<unknown>);

    let candidate: unknown;
    try {
      candidate = this.#next(args as StructuredArgs<unknown>);
    } catch (err) {
      return Promise.reject(err);
    }

    const parsed = args.schema.safeParse(candidate);
    if (!parsed.success) {
      const paths = parsed.error.issues
        .map((issue) => issue.path.join(".") || "(root)")
        .join(", ");
      return Promise.reject(
        new LlmError(
          `FakeLlmProvider value failed the caller schema (paths: ${paths})`,
          undefined,
          "schema",
        ),
      );
    }
    return Promise.resolve(parsed.data);
  }

  #next(args: StructuredArgs<unknown>): unknown {
    if (this.#handler) return this.#handler(args);
    if (this.#responses.length > 0) return this.#responses.shift();

    const minimal = minimalValueFor(args.schema);
    if (minimal.ok) return minimal.value;
    throw new LlmError(
      "FakeLlmProvider has no canned response for this schema — pass `responses` or a `handler`",
      undefined,
      "schema",
    );
  }
}

type Generated = { ok: true; value: unknown } | { ok: false };

/**
 * Best-effort minimal valid value for a zod schema, so a `FakeLlmProvider` with
 * no canned responses is still useful for a smoke test. Covers the shapes the
 * Sensitiv schemas actually use; returns `{ ok: false }` for anything exotic so
 * the caller gets the "no canned response" error rather than a bad guess.
 */
export function minimalValueFor(schema: ZodType<unknown>): Generated {
  // zod internals: stable across the zod 3.x line the project pins.
  const def = (schema as unknown as { _def?: Record<string, unknown> })._def;
  const typeName = def?.["typeName"] as string | undefined;

  switch (typeName) {
    case "ZodString": {
      const checks = (def?.["checks"] as { kind: string; value?: number }[]) ?? [];
      if (checks.some((c) => c.kind === "email")) {
        return { ok: true, value: "fixture@example.com" };
      }
      if (checks.some((c) => c.kind === "url")) {
        return { ok: true, value: "https://example.com/fixture" };
      }
      if (checks.some((c) => c.kind === "uuid")) {
        return { ok: true, value: "00000000-0000-4000-8000-000000000000" };
      }
      const min = checks.find((c) => c.kind === "min")?.value ?? 0;
      const base = "fixture";
      return { ok: true, value: base.length >= min ? base : base.padEnd(min, "x") };
    }
    case "ZodNumber": {
      const checks = (def?.["checks"] as { kind: string; value?: number }[]) ?? [];
      const min = checks.find((c) => c.kind === "min")?.value;
      const max = checks.find((c) => c.kind === "max")?.value;
      let value = typeof min === "number" ? min : 0;
      if (typeof max === "number" && value > max) value = max;
      return { ok: true, value };
    }
    case "ZodBoolean":
      return { ok: true, value: false };
    case "ZodDate":
      return { ok: true, value: new Date(0) };
    case "ZodLiteral":
      return { ok: true, value: def?.["value"] };
    case "ZodEnum": {
      const values = def?.["values"] as unknown[] | undefined;
      return values && values.length > 0
        ? { ok: true, value: values[0] }
        : { ok: false };
    }
    case "ZodNativeEnum": {
      const values = Object.values(
        (def?.["values"] as Record<string, unknown>) ?? {},
      );
      return values.length > 0 ? { ok: true, value: values[0] } : { ok: false };
    }
    case "ZodOptional":
    case "ZodDefault":
      return { ok: true, value: undefined };
    case "ZodNullable":
      return { ok: true, value: null };
    case "ZodEffects":
      return minimalValueFor(def?.["schema"] as ZodType<unknown>);
    case "ZodArray":
      return { ok: true, value: [] };
    case "ZodRecord":
    case "ZodMap":
      return { ok: true, value: {} };
    case "ZodTuple": {
      const items = (def?.["items"] as ZodType<unknown>[]) ?? [];
      const out: unknown[] = [];
      for (const item of items) {
        const g = minimalValueFor(item);
        if (!g.ok) return { ok: false };
        out.push(g.value);
      }
      return { ok: true, value: out };
    }
    case "ZodUnion":
    case "ZodDiscriminatedUnion": {
      const options = (def?.["options"] as Iterable<ZodType<unknown>>) ?? [];
      for (const option of options) {
        const g = minimalValueFor(option);
        if (g.ok) return g;
      }
      return { ok: false };
    }
    case "ZodObject": {
      const shapeFn = def?.["shape"] as (() => Record<string, ZodType<unknown>>) | undefined;
      if (!shapeFn) return { ok: false };
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(shapeFn())) {
        const childName = (child as { _def?: { typeName?: string } })._def?.typeName;
        // Skip optional / defaulted keys — "minimal" means omit what we can.
        if (childName === "ZodOptional" || childName === "ZodDefault") continue;
        const g = minimalValueFor(child);
        if (!g.ok) return { ok: false };
        out[key] = g.value;
      }
      return { ok: true, value: out };
    }
    default:
      return { ok: false };
  }
}

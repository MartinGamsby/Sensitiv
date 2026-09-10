import type { z } from "zod";

/**
 * Parse a JSON text column and validate it with a Zod schema. A corrupt row
 * produces a clear, contextual error — never a silent `any`.
 */
export function parseJsonColumn<S extends z.ZodTypeAny>(
  schema: S,
  raw: string,
  context: string,
): z.infer<S> {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`${context}: column is not valid JSON`);
  }
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new Error(`${context}: column failed schema validation: ${result.error.message}`);
  }
  return result.data;
}

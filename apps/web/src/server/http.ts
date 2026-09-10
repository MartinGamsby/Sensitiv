// Tiny response helpers so every handler returns JSON the same way.

export function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** A generic error body — never echo validation internals the client can't act on. */
export function errorResponse(status: number, message: string): Response {
  return jsonResponse(status, { error: message });
}

/** Read and JSON-parse a request body, or `undefined` when it is not valid JSON. */
export async function readJson(req: Request): Promise<unknown | undefined> {
  try {
    return (await req.json()) as unknown;
  } catch {
    return undefined;
  }
}

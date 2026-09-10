// GET /api/health — booleans and provider names only, so Section 9 can decide
// whether to show the BYOK Solari key field (`solari === false`). It must NEVER
// leak a key or a key prefix.
import { hasAnthropicKey, hasSolariKey } from "@sensitiv/shared/env";
import { getWebDeps } from "../../../server/deps.ts";
import { jsonResponse } from "../../../server/http.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const { env } = await getWebDeps();
  return jsonResponse(200, {
    solari: hasSolariKey(env),
    llm: hasAnthropicKey(env) ? "anthropic" : "fake",
  });
}

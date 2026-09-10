// GET /api/jobs/:id — the dossier + status for a job the caller owns.
// A job that does not exist OR belongs to another user returns 404 (never a
// distinguishable 403 — we don't confirm existence).
import { getDossier } from "@sensitiv/db";
import { getWebDeps } from "../../../../server/deps.ts";
import { errorResponse, jsonResponse } from "../../../../server/http.ts";
import { getCurrentUser } from "../../../../server/user.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { db } = await getWebDeps();
  const { id } = await ctx.params;
  const user = await getCurrentUser();

  const dossier = await getDossier(db, id, user.id);
  if (!dossier) return errorResponse(404, "not found");

  // `getDossier` already embeds `disclaimer: disclaimerFor(uiLocale)`.
  return jsonResponse(200, dossier);
}

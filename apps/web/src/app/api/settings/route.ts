// PATCH /api/settings — update the current user's persisted preferences.
import { z } from "zod";
import {
  MAX_JOB_TIMEOUT_SEC,
  MIN_JOB_TIMEOUT_SEC,
  UiLocaleSchema,
} from "@sensitiv/shared";
import { updateUserSettings } from "@sensitiv/db";
import { getWebDeps } from "../../../server/deps.ts";
import { errorResponse, jsonResponse, readJson } from "../../../server/http.ts";
import { getCurrentUser } from "../../../server/user.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SettingsPatchSchema = z
  .object({
    uiLocale: UiLocaleSchema.optional(),
    defaultSearchLang: z.string().trim().min(2).max(16).nullish(),
    defaultTimeoutSec: z
      .number()
      .int()
      .transform((n) =>
        Math.min(MAX_JOB_TIMEOUT_SEC, Math.max(MIN_JOB_TIMEOUT_SEC, n)),
      )
      .optional(),
  })
  .strip();

export async function PATCH(req: Request): Promise<Response> {
  const { db } = await getWebDeps();

  const raw = await readJson(req);
  if (raw === undefined || typeof raw !== "object" || raw === null) {
    return errorResponse(400, "request body must be a JSON object");
  }

  const parsed = SettingsPatchSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonResponse(400, {
      error: "invalid settings patch",
      issues: parsed.error.flatten(),
    });
  }

  const user = await getCurrentUser();
  const updated = await updateUserSettings(db, user.id, parsed.data);

  return jsonResponse(200, {
    user: {
      id: updated.id,
      uiLocale: updated.uiLocale,
      defaultSearchLang: updated.defaultSearchLang,
      defaultTimeoutSec: updated.defaultTimeoutSec,
    },
  });
}

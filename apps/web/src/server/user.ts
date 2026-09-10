import { getOrCreateLocalUser, type User } from "@sensitiv/db";
import { getWebDeps } from "./deps.ts";

/**
 * The v1 single-user resolver. Every read/write in the API is scoped by
 * `user.id`, so when real login is added later this is the only function that
 * changes — the route handlers keep filtering by `(await getCurrentUser()).id`.
 */
export async function getCurrentUser(): Promise<User> {
  const { db } = await getWebDeps();
  return getOrCreateLocalUser(db);
}

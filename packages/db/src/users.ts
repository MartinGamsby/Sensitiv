import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { UiLocaleSchema, type UiLocale } from "@sensitiv/shared";
import type { DbHandle } from "./client.ts";
import { users } from "./schema.ts";

export interface User {
  id: string;
  email: string;
  displayName: string | null;
  uiLocale: UiLocale;
  defaultSearchLang: string | null;
  defaultTimeoutSec: number;
  createdAt: number;
}

export const LOCAL_USER_EMAIL = "local@sensitiv.dev";
export const LOCAL_USER_DISPLAY_NAME = "Local";

function rowToUser(row: typeof users.$inferSelect): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    uiLocale: UiLocaleSchema.parse(row.uiLocale),
    defaultSearchLang: row.defaultSearchLang,
    defaultTimeoutSec: row.defaultTimeoutSec,
    createdAt: row.createdAt,
  };
}

async function findByEmail(
  db: DbHandle,
  email: string,
): Promise<User | undefined> {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  const row = rows[0];
  return row ? rowToUser(row) : undefined;
}

export async function getUser(
  db: DbHandle,
  userId: string,
): Promise<User | undefined> {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const row = rows[0];
  return row ? rowToUser(row) : undefined;
}

/**
 * The single v1 user (`local@sensitiv.dev`, display name "Local"). Idempotent:
 * concurrent callers converge on one row thanks to the unique `email` and
 * `onConflictDoNothing`.
 */
export async function getOrCreateLocalUser(db: DbHandle): Promise<User> {
  const existing = await findByEmail(db, LOCAL_USER_EMAIL);
  if (existing) return existing;

  await db
    .insert(users)
    .values({
      id: randomUUID(),
      email: LOCAL_USER_EMAIL,
      displayName: LOCAL_USER_DISPLAY_NAME,
      uiLocale: "en",
      defaultSearchLang: null,
      defaultTimeoutSec: 480,
      createdAt: Date.now(),
    })
    .onConflictDoNothing();

  const created = await findByEmail(db, LOCAL_USER_EMAIL);
  if (!created) throw new Error("getOrCreateLocalUser: row vanished after insert");
  return created;
}

export interface UserSettingsPatch {
  uiLocale?: UiLocale;
  defaultSearchLang?: string | null;
  defaultTimeoutSec?: number;
}

export async function updateUserSettings(
  db: DbHandle,
  userId: string,
  patch: UserSettingsPatch,
): Promise<User> {
  const set: Partial<typeof users.$inferInsert> = {};
  if (patch.uiLocale !== undefined) {
    set.uiLocale = UiLocaleSchema.parse(patch.uiLocale);
  }
  if (patch.defaultSearchLang !== undefined) {
    set.defaultSearchLang = patch.defaultSearchLang;
  }
  if (patch.defaultTimeoutSec !== undefined) {
    set.defaultTimeoutSec = patch.defaultTimeoutSec;
  }

  if (Object.keys(set).length === 0) {
    const current = await getUser(db, userId);
    if (!current) throw new Error(`updateUserSettings: unknown user ${userId}`);
    return current;
  }

  const updated = await db
    .update(users)
    .set(set)
    .where(eq(users.id, userId))
    .returning();
  const row = updated[0];
  if (!row) throw new Error(`updateUserSettings: unknown user ${userId}`);
  return rowToUser(row);
}

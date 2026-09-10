import { afterEach, describe, expect, it } from "vitest";
import type { Database } from "./client.ts";
import { getOrCreateLocalUser, updateUserSettings } from "./users.ts";
import { makeTestDb } from "../test/helpers.ts";

let handle: Database | undefined;
afterEach(() => {
  handle?.client.close();
  handle = undefined;
});

describe("getOrCreateLocalUser", () => {
  it("is idempotent — twice yields the same id", async () => {
    handle = await makeTestDb();
    const first = await getOrCreateLocalUser(handle.db);
    const second = await getOrCreateLocalUser(handle.db);
    expect(first.id).toBe(second.id);
    expect(first.email).toBe("local@sensitiv.dev");
    expect(first.displayName).toBe("Local");
  });

  it("does not duplicate rows on repeated calls", async () => {
    handle = await makeTestDb();
    await getOrCreateLocalUser(handle.db);
    await getOrCreateLocalUser(handle.db);
    await getOrCreateLocalUser(handle.db);
    const count = await handle.client.execute("SELECT COUNT(*) AS n FROM users");
    expect(count.rows[0]?.n).toBe(1);
  });
});

describe("updateUserSettings", () => {
  it("patches only the provided fields", async () => {
    handle = await makeTestDb();
    const user = await getOrCreateLocalUser(handle.db);
    const updated = await updateUserSettings(handle.db, user.id, {
      uiLocale: "fr",
      defaultTimeoutSec: 600,
    });
    expect(updated.uiLocale).toBe("fr");
    expect(updated.defaultTimeoutSec).toBe(600);
    expect(updated.defaultSearchLang).toBeNull();
  });

  it("throws for an unknown user", async () => {
    handle = await makeTestDb();
    await expect(
      updateUserSettings(handle.db, "nope", { uiLocale: "en" }),
    ).rejects.toThrow();
  });
});

// @sensitiv/db — the only module in the repo that talks to SQLite.
// No other package may import `drizzle-orm` or `@libsql/client` directly.
export * as schema from "./schema.ts";
export {
  createDb,
  getDb,
  findRepoRoot,
  resolveDatabaseUrl,
  type Database,
  type DbHandle,
} from "./client.ts";
export { runMigrations } from "./migrate.ts";
export { seed } from "./seed.ts";
export {
  getOrCreateLocalUser,
  getUser,
  updateUserSettings,
  LOCAL_USER_EMAIL,
  LOCAL_USER_DISPLAY_NAME,
  type User,
  type UserSettingsPatch,
} from "./users.ts";
export {
  createJob,
  getJob,
  listJobsForUser,
  markJobRunning,
  finishJob,
  type Job,
  type CreateJobInput,
  type FinishJobStatus,
} from "./jobs.ts";
export {
  appendEvent,
  listEventsAfter,
  type JobEventLevel,
} from "./events.ts";
export {
  upsertPlace,
  setPlaceScore,
  addPlaceSource,
  addEvidence,
  addReplay,
  getDossier,
  type ReplayInput,
} from "./results.ts";

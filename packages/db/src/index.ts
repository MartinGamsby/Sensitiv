// @sensitiv/db — the only module in the repo that talks to SQLite.
// No other package may import `drizzle-orm` or `@libsql/client` directly.
export * as schema from "./schema.ts";
export {
  createDb,
  getDb,
  findRepoRoot,
  replaysRoot,
  resolveStoredReplayPath,
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
  deleteJobForUser,
  getJob,
  getJobById,
  listJobsForUser,
  listQueuedJobs,
  listRunningJobs,
  recentRunDurationsForUser,
  markJobRunning,
  finishJob,
  setJobSearchCenter,
  setJobSourceModes,
  type Job,
  type CreateJobInput,
  type DeletedJob,
  type FinishJobStatus,
} from "./jobs.ts";
export {
  appendEvent,
  listEventsAfter,
  type JobEventLevel,
} from "./events.ts";
export {
  getCachedExtractions,
  putCachedExtractions,
  pruneExpiredExtractions,
  clearCachedExtractions,
  type CachedExtraction,
} from "./extraction-cache.ts";
export {
  upsertPlace,
  setPlaceScore,
  addPlaceSource,
  addEvidence,
  addReplay,
  getDossier,
  getPlacePhotoUrl,
  getReplayForJob,
  listJobSummariesForUser,
  listReplaysToPrune,
  markReplayExpired,
  type ReplayInput,
  type JobSummary,
} from "./results.ts";

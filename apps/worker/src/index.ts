// Worker entrypoint: a long-running Node process (never a serverless handler).
// Boots the loopback HTTP server and, unless WORKER_POLL=off, a poll loop that
// claims queued jobs from SQLite.
import { loadEnv } from "@sensitiv/shared/env";
import { startServer } from "./server.ts";

// A dangling rejection from an aborted job must not kill the process.
process.on("unhandledRejection", (reason) => {
  process.stderr.write(`[worker] unhandledRejection: ${String(reason)}\n`);
});

async function main(): Promise<void> {
  const env = loadEnv();
  const poll = process.env.WORKER_POLL !== "off";
  const server = await startServer({ port: env.WORKER_PORT, poll });
  process.stdout.write(
    `[worker] listening on ${server.url} — llm ${env.ANTHROPIC_API_KEY ? "anthropic" : "fake"}, ` +
      `solari ${env.SOLARI_API_KEY ? "live" : "fixtures"}, poll ${poll ? "on" : "off"}\n`,
  );

  const shutdown = (): void => {
    void server.close().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err: unknown) => {
  process.stderr.write(`[worker] fatal: ${String(err)}\n`);
  process.exit(1);
});

// Worker entrypoint: a long-running Node process (never a serverless handler).
// Boots the loopback HTTP server and, unless WORKER_POLL=off, a poll loop that
// claims queued jobs from SQLite.
//
// `loadDotEnvFile()` must run before ANYTHING else touches `process.env`: the
// worker is a plain `tsx` process with no dotenv of its own, so a root `.env`
// (the one README / .env.example describe) was otherwise invisible here even
// with a real key in it. `./server.ts` is imported dynamically, AFTER the
// call, so nothing in its import graph can read `process.env` first.
import { loadDotEnvFile, loadEnv } from "@sensitiv/shared/env";

loadDotEnvFile();

// A dangling rejection from an aborted job must not kill the process.
process.on("unhandledRejection", (reason) => {
  process.stderr.write(`[worker] unhandledRejection: ${String(reason)}\n`);
});

async function main(): Promise<void> {
  const { startServer } = await import("./server.ts");
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

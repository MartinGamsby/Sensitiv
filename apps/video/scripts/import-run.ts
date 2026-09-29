// pnpm video:import <jobId> [scenario-id] [--allow-sample-data]
//
// Freezes a finished research run from the local database into
// `apps/video/scenarios/<scenario-id>.run.json`, which the scenario file then
// imports. The job id may be abbreviated to any unique prefix, as the run page
// URL shows it.
//
// Refuses a run that used recorded sample data for any source unless told
// otherwise: a demo built on one would pass canned results off as a search.
// With --allow-sample-data the video shows the app's own "sample data" strip.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadDotEnvFile } from "@sensitiv/shared/env";
import {
  createDb,
  getDossier,
  getJob,
  getOrCreateLocalUser,
  listEventsAfter,
  listJobsForUser,
} from "@sensitiv/db";
import type { JobEvent } from "@sensitiv/shared";
import { toSnapshot } from "../src/import/to-snapshot.ts";

function usage(message?: string): never {
  if (message) console.error(`\n  ${message}\n`);
  console.error(
    "  usage: pnpm video:import <jobId-or-prefix> [scenario-id] [--allow-sample-data]\n",
  );
  process.exit(1);
}

const args = process.argv.slice(2).filter((a) => a !== "--");
const allowSample = args.includes("--allow-sample-data");
const [jobArg, scenarioArg] = args.filter((a) => !a.startsWith("--"));
if (!jobArg) usage("Which run? Pass its job id (or the start of it).");
if (scenarioArg && !/^[a-z0-9][a-z0-9-]*$/.test(scenarioArg)) {
  usage(`"${scenarioArg}" is not a scenario id (lowercase letters, digits, dashes).`);
}

loadDotEnvFile();
const { db, client } = await createDb();
try {
  const user = await getOrCreateLocalUser(db);

  let job = await getJob(db, jobArg, user.id);
  if (!job) {
    const matches = (await listJobsForUser(db, user.id, 500)).filter((j) =>
      j.id.startsWith(jobArg),
    );
    if (matches.length === 0) usage(`No run of yours starts with "${jobArg}".`);
    if (matches.length > 1) {
      usage(
        `"${jobArg}" matches ${matches.length} runs: ${matches
          .map((j) => j.id.slice(0, 8))
          .join(", ")}. Use more of the id.`,
      );
    }
    job = matches[0]!;
  }

  const dossier = await getDossier(db, job.id, user.id);
  if (!dossier) usage(`Run ${job.id} has no dossier.`);

  const events: JobEvent[] = [];
  for (let after = 0; ; ) {
    const page = await listEventsAfter(db, job.id, after, 200);
    events.push(...page);
    if (page.length < 200) break;
    after = page[page.length - 1]!.id;
  }

  const report = toSnapshot(job, dossier, events, new Date());

  if (report.sampleSources.length > 0 && !allowSample) {
    usage(
      `Run ${job.id.slice(0, 8)} used recorded SAMPLE data for: ${report.sampleSources.join(", ")}.\n` +
        "  A demo built on it would present canned results as a real search. Run the\n" +
        "  search again with live sources, or pass --allow-sample-data (the video then\n" +
        '  shows the app\'s own "sample data" warning, as the dossier does).',
    );
  }

  const id = scenarioArg ?? `run-${job.id.slice(0, 8)}`;
  const out = fileURLToPath(new URL(`../scenarios/${id}.run.json`, import.meta.url));
  writeFileSync(out, `${JSON.stringify(report.snapshot, null, 2)}\n`);

  const evidence = report.snapshot.places.reduce((n, p) => n + p.evidence.length, 0);
  console.log(`\n  Imported run ${job.id}`);
  console.log(`    "${report.snapshot.request}" · ${report.snapshot.places.length} places · ${evidence} evidence items`);
  console.log(`    sources: ${Object.entries(report.snapshot.sourceModes).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  console.log(`    photos kept: ${report.photosKept}`);
  if (report.avatarsDropped.length > 0) {
    console.log(
      `    photos dropped (a reviewer's account picture, not the place): ${report.avatarsDropped.join(", ")}`,
    );
  }
  if (report.unavailableSources.length > 0) {
    console.log(`    could not be searched: ${report.unavailableSources.join(", ")}`);
  }
  console.log(`  → ${out}`);
  if (!scenarioArg) {
    console.log(
      `\n  Point a scenario at it:  import run from "./${id}.run.json";  …  run,\n`,
    );
  }
} finally {
  client.close();
}

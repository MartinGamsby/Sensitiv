import { setRequestLocale } from "next-intl/server";
import { getJob, recentRunDurationsForUser } from "@sensitiv/db";
import { RunView } from "@/components/run-view.tsx";
import { getWebDeps } from "@/server/deps.ts";
import { getCurrentUser } from "@/server/user.ts";
import { medianMs } from "@/lib/run-estimate.ts";

/**
 * The live run stream is still SSE (`RunView` opens it client-side). This
 * server pass only reads what the client cannot: when the run started, its
 * budget, and how long this user's previous runs took — the sample the progress
 * bar's ETA is a median of. All of it is scoped by `user.id` like every other
 * job read; a job that is missing or not this user's yields nothing extra, and
 * `RunView` renders the same not-found path it always has.
 */
export default async function RunPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const { db } = await getWebDeps();
  const user = await getCurrentUser();
  const job = await getJob(db, id, user.id);
  const baselineMs = job
    ? medianMs(await recentRunDurationsForUser(db, user.id))
    : undefined;

  return (
    <RunView
      jobId={id}
      startedAtMs={job?.startedAt ?? undefined}
      timeoutMs={job ? job.timeoutSec * 1000 : undefined}
      baselineMs={baselineMs}
    />
  );
}

import { setRequestLocale } from "next-intl/server";
import { getJob, recentRunDurationsForUser } from "@sensitiv/db";
import { RunView } from "@/components/run-view.tsx";
import { getWebDeps } from "@/server/deps.ts";
import { getCurrentUser } from "@/server/user.ts";
import { medianMs } from "@/lib/run-estimate.ts";
import type { RunBriefData } from "@/lib/run-brief.ts";

/**
 * The live run stream is still SSE (`RunView` opens it client-side). This
 * server pass reads what the client cannot: when the run started, its budget,
 * how long this user's previous runs took — the sample the progress bar's ETA
 * is a median of — and the run's own QUESTION, which lives on the `jobs` row
 * and never reached the page before. All of it is scoped by `user.id` like
 * every other job read; a job that is missing or not this user's yields
 * nothing extra, and `RunView` renders the same not-found path it always has.
 *
 * The brief comes from here rather than from the dossier because it has to
 * render while the run is still going, before there is a dossier at all.
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

  const brief: RunBriefData | undefined = job
    ? {
        requestText: job.requestText,
        location: job.location,
        requirements: job.requirements,
        searchLang: job.searchLang,
        createdAt: job.createdAt,
        searchCenter: job.searchCenter,
      }
    : undefined;

  return (
    <RunView
      jobId={id}
      brief={brief}
      startedAtMs={job?.startedAt ?? undefined}
      timeoutMs={job ? job.timeoutSec * 1000 : undefined}
      baselineMs={baselineMs}
    />
  );
}

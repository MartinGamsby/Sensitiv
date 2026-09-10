import { setRequestLocale } from "next-intl/server";
import { JobHistory } from "@/components/job-history.tsx";

export default async function JobsHistoryPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <JobHistory />;
}

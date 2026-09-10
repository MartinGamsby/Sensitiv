import { setRequestLocale } from "next-intl/server";
import { RunView } from "@/components/run-view.tsx";

export default async function RunPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return <RunView jobId={id} />;
}

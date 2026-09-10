import { setRequestLocale } from "next-intl/server";
import { RunForm } from "@/components/run-form.tsx";

export default async function LandingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <RunForm />;
}

/**
 * A BCP-47 code as a language name in the reader's locale — "en" -> "English"
 * under an English UI, "anglais" under a French one.
 *
 * The run brief states which language the SOURCES were searched in, and that
 * is a fact about the run worth reading: a Montréal dossier searched in
 * English and the same one searched in French are not the same research.
 * Printing the raw code made it look like debug output.
 *
 * Falls back to the code itself. `Intl.DisplayNames` is missing on nothing
 * this app supports, but `searchLang` is a free-text column — a value it
 * cannot parse throws, and a run is not worth breaking over its label.
 */
export function languageName(code: string, locale: string): string {
  const trimmed = code.trim();
  if (trimmed === "") return code;
  try {
    return (
      new Intl.DisplayNames([locale], { type: "language" }).of(trimmed) ?? trimmed
    );
  } catch {
    return trimmed;
  }
}

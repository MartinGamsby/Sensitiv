import type {
  Evidence,
  ProgressUnit,
  Location,
  PlaceDetail,
  PlaceSource,
  PlannedRequirement,
  SearchLanguage,
  UiLocale,
} from "@sensitiv/shared";
import type { LlmProvider } from "@sensitiv/shared/llm";
import type { BrowserSession } from "../browser/solari.ts";
import type { JobLogLevel } from "../logger.ts";

/**
 * One search an adapter should run, in both forms.
 *
 * An adapter that can pin its own map viewport (`google_maps`, via the
 * `/@lat,lng,<z>z` URL segment) sends `subject` and lets the viewport carry the
 * geography. One that cannot has to bake the location into the text and send
 * `query`. Keeping both on one object is what stops the two from drifting out
 * of alignment through a dedupe.
 */
export interface AdapterQuery {
  /** Subject + location phrase: "sans gluten restaurant Montreal H2T". */
  query: string;
  /** Subject only: "sans gluten restaurant". */
  subject: string;
}

/** One place as seen through ONE source, with its evidence. Merge keys on `place.canonicalKey`. */
export interface PlaceFinding {
  place: PlaceDetail;
  source: PlaceSource;
  evidence: Evidence[];
}

export interface AdapterResult {
  findings: PlaceFinding[];
}

export interface AdapterContext {
  jobId: string;
  /** Catalog intent ids this adapter is being run for. */
  intentIds: string[];
  location: Location;
  searchLang: SearchLanguage;
  uiLocale: UiLocale;
  requirements: PlannedRequirement[];
  /** Search strings, already in the search language. */
  queries: AdapterQuery[];
  /** Max places to keep for this adapter (`intent.defaultLimit`). */
  limit: number;
  browser: BrowserSession;
  llm: LlmProvider;
  log: (level: JobLogLevel, message: string) => Promise<void>;
  /**
   * Report how far through its own work this adapter is.
   *
   * `fraction` (0..1) drives the progress bar; `done`/`total`/`unit` only label
   * it. They are separate because the honest label changes units partway
   * through — "query 2 of 2", then "place 7 of 22" — and a bar that followed
   * the label would run backwards at the handover.
   *
   * Optional, and calling it is best-effort: an adapter that never reports just
   * contributes its share on completion, exactly as before.
   */
  reportProgress?: (update: AdapterProgress) => void;
  /** The job budget's signal — aborts on timeout. */
  signal: AbortSignal;
}

export interface AdapterProgress {
  /** Completion of THIS adapter's work, 0..1. */
  fraction: number;
  done?: number;
  total?: number;
  unit?: ProgressUnit;
}

export interface Adapter {
  id: string;
  supports(intentId: string): boolean;
  run(ctx: AdapterContext): Promise<AdapterResult>;
  /** False for adapters that never touch `ctx.browser` (the v1.1 stubs). The
   *  runner skips launching a session for them — a live Solari session is paid,
   *  recorded, and rate-limited. Defaults to true when omitted. */
  needsBrowser?: boolean;
}

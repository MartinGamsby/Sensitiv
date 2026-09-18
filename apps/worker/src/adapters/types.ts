import type {
  Evidence,
  ProgressUnit,
  Location,
  PlaceDetail,
  PlaceSource,
  PlannedRequirement,
  SearchLanguage,
  SourceMode,
  UiLocale,
} from "@sensitiv/shared";
import type { LlmProvider } from "@sensitiv/shared/llm";
import type { BrowserSession } from "../browser/solari.ts";
import type { ExtractionCache } from "../extraction-cache.ts";
import type { FetchLike } from "../http.ts";
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
  /**
   * What this adapter actually ran against, when it is the only thing that
   * knows.
   *
   * The runner derives `sourceModes` from the browser session it launched, which
   * covers every adapter that drives a browser. An adapter that reads an HTTP
   * API instead has no session to read a mode off, and would otherwise be
   * recorded as `"stub"` — the value reserved for the v1.1 no-ops — which puts
   * a real live source under the dossier's "not searched" line. Reporting it
   * here is how such an adapter says "that was live" or "that was my fixture".
   *
   * Omitted leaves the runner's own reading in place, so nothing changes for
   * the browser adapters.
   */
  mode?: SourceMode;
  /**
   * Where this adapter actually searched, when it resolved a point.
   *
   * The runner cannot work this out for itself: a job carrying a postal code
   * has no coordinates by design (see `resolveLocation`), because the adapter's
   * Maps hop is the only lookup that can read one. The adapter is therefore the
   * only thing that knows the centre, and scoring needs it for the proximity
   * term.
   */
  center?: { lat: number; lng: number };
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
  /**
   * Outbound HTTP, for an adapter that reads an API rather than a page.
   *
   * Injected rather than taken from the global so tests stay network-free; the
   * default (`defaultAdapterFetch`) refuses outright under the test runner, the
   * same fail-closed rule the Solari module loader follows.
   */
  fetch: FetchLike;
  llm: LlmProvider;
  /**
   * Extractions this install has already paid for, so a re-run does not re-ask
   * the model about a listing it has already read.
   *
   * Absent when `EXTRACTION_CACHE_TTL_HOURS=0`, and absent under the test
   * runner unless a test supplies one — injected like `fetch` above, for the
   * same reason: the extractor stays pure and nothing reaches for a database
   * on its own.
   */
  extractionCache?: ExtractionCache;
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

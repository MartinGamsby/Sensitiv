import type {
  Evidence,
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
  /** Search strings, already in the search language + carrying the location. */
  queries: string[];
  /** Max places to keep for this adapter (`intent.defaultLimit`). */
  limit: number;
  browser: BrowserSession;
  llm: LlmProvider;
  log: (level: JobLogLevel, message: string) => Promise<void>;
  /** The job budget's signal — aborts on timeout. */
  signal: AbortSignal;
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

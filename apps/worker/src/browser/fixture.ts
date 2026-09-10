// The fallback browser: serves committed fixture JSON/HTML, records nothing, and
// returns `undefined` for the replay URL. Used whenever there is no Solari key
// or the SDK import fails — which is the whole "dummy run" path for this build.
import { randomUUID } from "node:crypto";
import type { BrowserPage, BrowserSession } from "./solari.ts";

export class FixtureBrowserSession implements BrowserSession {
  readonly mode = "fixture" as const;
  readonly sessionId = `fixture-${randomUUID()}`;
  #closed = false;
  #pages: FixturePage[] = [];

  constructor(readonly payload: unknown = undefined) {}

  newPage(): Promise<BrowserPage> {
    const page = new FixturePage(this.payload);
    this.#pages.push(page);
    return Promise.resolve(page);
  }

  close(): Promise<void> {
    this.#closed = true;
    for (const page of this.#pages) void page.close();
    return Promise.resolve();
  }

  get closed(): boolean {
    return this.#closed;
  }

  getReplayUrl(): Promise<string | undefined> {
    return Promise.resolve(undefined);
  }
}

class FixturePage implements BrowserPage {
  #url = "about:blank";

  constructor(readonly payload: unknown) {}

  goto(url: string): Promise<void> {
    this.#url = url;
    return Promise.resolve();
  }

  waitForTimeout(): Promise<void> {
    return Promise.resolve();
  }

  /** Fixture pages ignore the page-side function and return the recorded blob. */
  evaluate<T>(): Promise<T> {
    const blob = (this.payload as { blob?: unknown } | undefined)?.blob;
    return Promise.resolve(blob as T);
  }

  content(): Promise<string> {
    return Promise.resolve(JSON.stringify(this.payload ?? {}));
  }

  get url(): string {
    return this.#url;
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

// Fetching third-party bytes for the video, under the same rules the web
// app's photo route applies (`apps/web/.../places/[key]/photo/route.ts`,
// memory/security-invariants.md → "Place photos"): no redirects off the host
// that was approved, a timeout, a size cap counted while streaming, and a
// content-type allowlist that never includes SVG.

export const IMAGE_TYPES: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

export const AUDIO_TYPES: Readonly<Record<string, string>> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/aac": "aac",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
};

export interface Fetched {
  bytes: Uint8Array;
  /** The allowlisted extension for the content type that came back. */
  ext: string;
}

export class DownloadError extends Error {}

/** The body, or a `DownloadError` the moment it passes `max` bytes. */
async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw new DownloadError(`larger than ${Math.round(max / 1024 / 1024)} MB`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

export async function download(
  url: string,
  options: {
    types: Readonly<Record<string, string>>;
    maxBytes: number;
    timeoutMs?: number;
    headers?: Record<string, string>;
    fetchImpl?: typeof fetch;
  },
): Promise<Fetched> {
  const doFetch = options.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(options.timeoutMs ?? 8_000),
      headers: options.headers,
    });
  } catch (err) {
    throw new DownloadError(err instanceof Error ? err.message : String(err));
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw new DownloadError(`HTTP ${res.status}`);
  }
  const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  const ext = options.types[type];
  if (!ext) {
    await res.body?.cancel().catch(() => undefined);
    throw new DownloadError(`unexpected content type "${type || "none"}"`);
  }
  const bytes = await readCapped(res, options.maxBytes);
  if (bytes.byteLength === 0) throw new DownloadError("empty body");
  return { bytes, ext };
}

/** Runs `task` over `items`, `limit` at a time. */
export async function eachLimit<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await task(item);
    }
  });
  await Promise.all(workers);
}
